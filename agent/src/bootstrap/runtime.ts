import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import type { PoolConfiguration } from '../admission/index.js';
import { addResources } from '../admission/index.js';
import { DockerBackend } from '../backends/docker/index.js';
import { openJournal } from '../journal/index.js';
import type { Journal } from '../journal/index.js';
import type { JournalOptions } from '../journal/index.js';
import { InstallationStateError, openServingState } from '../installation-state/index.js';
import type { ServingState } from '../installation-state/index.js';
import { Stager, verifyInstallation } from '../staging/index.js';
import type { VerifiedRoot } from '../staging/index.js';
import { Supervisor } from '../supervisor/index.js';
import { createInstallationController } from '../installation/index.js';
import type { InstallationController } from '../installation/index.js';
import { createOutputGuard } from '../guard/index.js';
import type { OutputGuard } from '../guard/index.js';
import { createTimeoutGuard } from '../timeout/index.js';
import type { TimeoutGuard } from '../timeout/index.js';
import { createObservationPublisher, createResourceObserver } from '../observation/index.js';
import type { ObservationPublisher, ResourceObserver } from '../observation/index.js';
import { createScheduler } from '../scheduler/index.js';
import type { Scheduler } from '../scheduler/index.js';
import { createOutputSourceReader } from '../output-transfer/index.js';
import { readOutputRange } from '../collection/output/index.js';
import { AgentHttpError, createAgentServer } from '../transport/index.js';
import type { FastifyInstance } from 'fastify';
import { CapabilityView } from './capabilities.js';
import { installationStatePath } from './authority-state.js';
import { verifyInstalledImages } from './installed-images.js';
import { AgentRuntimeError } from './types.js';
import type { AgentRuntime, AgentRuntimeOptions } from './types.js';

let owner: RuntimeOwner | undefined;
type Close = () => Promise<unknown>;
async function drain(operations: Close[]): Promise<boolean> {
  const originals = operations.map(operation => {
    try { return Promise.resolve(operation()); } catch (error) { return Promise.reject(error); }
  });
  const results = await Promise.allSettled(originals);
  return results.every(result => result.status === 'fulfilled');
}
function journalCopy(input: JournalOptions): JournalOptions {
  const result: Record<string, unknown> = {};
  for (const key of ['path', 'queueLimit', 'spoolQuotaBytes', 'workerUrl']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor && !('value' in descriptor)) throw new AgentRuntimeError('startup');
    if (descriptor) result[key] = descriptor.value;
  }
  if (result.workerUrl !== undefined) {
    const href = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!.call(result.workerUrl) as string;
    result.workerUrl = new URL(href);
  }
  return Object.freeze(result) as unknown as JournalOptions;
}
function capture(input: AgentRuntimeOptions): AgentRuntimeOptions {
  const result: Record<string, unknown> = {};
  for (const name of ['journal', 'installation', 'transport', 'catalog', 'configuration', 'providers', 'credential', 'minimumFreeBytes', 'signal']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor && !('value' in descriptor)) throw new AgentRuntimeError('startup');
    result[name] = descriptor?.value;
  }
  if (typeof result.minimumFreeBytes !== 'number' || !Number.isSafeInteger(result.minimumFreeBytes) || result.minimumFreeBytes < 0) {
    throw new AgentRuntimeError('startup');
  }
  const options = result as unknown as AgentRuntimeOptions;
  return Object.freeze({ ...options, journal: journalCopy(options.journal),
    installation: JSON.parse(encodeJson(options.installation, 4096)) as AgentRuntimeOptions['installation'],
    configuration: JSON.parse(encodeJson(options.configuration, 65_536)) as AgentRuntimeOptions['configuration'] });
}
/** One retained owner covers initialization, service originals and failed cleanup. */
class RuntimeOwner {
  private authorityState?: ServingState;
  private authorityCleanupUnknown = false;
  private journal?: Journal;
  private supervisor?: Supervisor;
  private installation?: InstallationController;
  private output?: OutputGuard;
  private timeout?: TimeoutGuard;
  private observer?: ResourceObserver;
  private publisher?: ObservationPublisher;
  private scheduler?: Scheduler;
  private server?: FastifyInstance;
  private readonly stagers = new Map<object, Stager>();
  private closed = false;
  private closing?: Promise<void>;
  async open(input: AgentRuntimeOptions): Promise<AgentRuntime> {
    const options = capture(input); this.check(options);
    const authorityState = this.openAuthority(installationStatePath(options.journal.path));
    const verified = await verifyInstallation({ configuration: options.installation, transport: options.transport,
      operation: { deadline: performance.now() + 30_000, ...(options.signal ? { signal: options.signal } : {}) } });
    this.check(options);
    if (!verified.ok) throw new AgentRuntimeError('startup');
    if (!await verifyInstalledImages({ catalog: options.catalog, transport: options.transport,
      expectedDaemonId: options.installation.expectedDaemonId, operation: { deadline: performance.now() + 30_000,
        ...(options.signal ? { signal: options.signal } : {}) } })) throw new AgentRuntimeError('startup');
    this.check(options);
    this.journal = await openJournal(options.journal); this.check(options);
    const authority = await this.journal.journalAuthority(); this.check(options);
    authorityState.assertJournalAuthority(authority);
    const configuration = JSON.parse(encodeJson({ ...options.configuration,
      profiles: options.catalog.engines.map(engine => engine.approved) }, 65_536)) as PoolConfiguration;
    await this.journal.admission({ kind: 'configure', configuration }); this.check(options);
    this.compose(options, configuration, verified.value, authority);
    this.check(options);
    this.output!.start(); this.timeout!.start(); this.publisher!.start(); this.scheduler!.start();
    const server = this.server!; const initial = this.publisher!.initial;
    return Object.freeze({ server, initial, status: () => this.status(), close: () => this.close() });
  }
  private openAuthority(path: string): ServingState {
    try { return this.authorityState = openServingState(path); }
    catch (error) {
      // A failed native acquisition cleanup may retain a handle inside the control store.
      this.authorityCleanupUnknown = !(error instanceof InstallationStateError)
        || !['owned', 'recovery_required', 'invalid_input'].includes(error.code);
      throw error;
    }
  }
  private check(options: AgentRuntimeOptions): void {
    if (this.closed || options.signal?.aborted) throw new AgentRuntimeError('closed');
  }
  private compose(options: AgentRuntimeOptions, configuration: PoolConfiguration, root: VerifiedRoot, journalAuthority: string): void {
    const journal = this.journal!;
    const transport = options.transport;
    const supervisor = this.supervisor = new Supervisor({ journal, installationId: options.installation.installationId,
      backendFactory: () => new DockerBackend(transport) });
    for (const engine of options.catalog.engines) this.stagers.set(engine, new Stager({ root, journal,
      profile: engine.profile, manifest: engine.manifest, validation: engine.validation, providers: options.providers }));
    const overhead = addResources(configuration.controlReserve, configuration.headroom);
    this.output = createOutputGuard({ root, minimumFreeBytes: Math.max(options.minimumFreeBytes, overhead.outputBytes + overhead.stagingBytes),
      stop: (key, reason) => this.installation!.stop(key, reason) });
    this.timeout = createTimeoutGuard({ stop: (key, reason) => this.installation!.stop(key, reason) });
    this.installation = createInstallationController({ journal, catalog: options.catalog, supervisor, guard: this.output, timeout: this.timeout,
      stagerFor: engine => {
        const stager = this.stagers.get(engine);
        if (!stager) throw new AgentRuntimeError('startup');
        return stager;
      } });
    this.observer = createResourceObserver({ root, transport: options.transport, configuration });
    const view = new CapabilityView({ configuration, catalog: options.catalog, journalAuthority,
      published: () => this.closed ? null : this.publisher?.snapshot() ?? null });
    this.publisher = createObservationPublisher({ journal, observer: this.observer, output: this.output, timeout: this.timeout });
    this.scheduler = createScheduler({ journal, installation: this.installation });
    this.server = createAgentServer({ credential: options.credential, journalAuthority, journal, installation: this.installation,
      outputs: createOutputSourceReader({ journal, readRange: readOutputRange }), absences: journal, capabilities: () => view.capabilities() });
    this.server.addHook('onRequest', async () => {
      if (this.closed) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    });
  }
  private status() {
    return { ready: !this.closed && this.publisher?.status().ready === true, closed: this.closed,
      retainedActors: this.supervisor!.size, scheduler: this.scheduler!.status() };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    let resolve!: () => void; let reject!: (error: unknown) => void;
    this.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void this.shutdown().then(resolve, reject);
    return this.closing;
  }
  private executionCloses(): Close[] {
    const first: Close[] = [];
    if (this.server) first.push(() => this.server!.close());
    if (this.publisher) first.push(() => this.publisher!.close());
    if (this.scheduler) first.push(() => this.scheduler!.close());
    if (this.installation) first.push(() => this.installation!.close());
    for (const stager of this.stagers.values()) first.push(() => stager.close());
    return first;
  }
  private monitoringCloses(): Close[] {
    const guards: Close[] = [];
    if (this.output) guards.push(() => this.output!.close());
    if (this.timeout) guards.push(() => this.timeout!.close());
    if (this.observer) guards.push(() => this.observer!.close());
    return guards;
  }
  private async shutdown(): Promise<void> {
    const primary = await drain(this.executionCloses());
    const monitored = await drain(this.monitoringCloses());
    if (!primary || !monitored || this.authorityCleanupUnknown) throw new AgentRuntimeError('cleanup');
    try { await this.journal?.close(); } catch { throw new AgentRuntimeError('cleanup'); }
    try { this.authorityState?.close(); } catch { throw new AgentRuntimeError('cleanup'); }
    if (owner === this) owner = undefined;
  }
}
/** Executable owns transport construction and listening; all execution components are bound here. */
export async function openAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  if (owner) throw new AgentRuntimeError('busy');
  const current = new RuntimeOwner(); owner = current;
  try { return await current.open(options); }
  catch {
    await current.close();
    throw new AgentRuntimeError('startup');
  }
}
