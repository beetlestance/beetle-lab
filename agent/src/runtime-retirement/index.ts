import { encodeCanonicalJson } from '@beetle/contracts';
import { daemonResources } from '../backends/docker/index.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { ProducerBarrier } from '../producer-retirement/index.js';
import { producerIntent, releasedRuntime, runtimeKey, ownedDaemon } from './authority.js';
import { captureWindow, checkWindow } from './window.js';
import { mintRuntimeAbsent } from './capability.js';
import { RuntimeRetirementError } from './types.js';
import type { RuntimeRetirementOptions, RuntimeAbsent, RuntimeAbsentFacts } from './types.js';
export { RuntimeRetirementError } from './types.js';
export { runtimeAbsentFacts } from './capability.js';
export type { RuntimeRetirementOptions, RuntimeAbsent, RuntimeAbsentFacts } from './types.js';
type Backend = ReturnType<RuntimeRetirementOptions['backend']>;
interface Entry { readonly digest: string; starting: boolean; abort?: AbortController; backend?: Backend; active?: Promise<RuntimeAbsent> }
const owners = new WeakMap<JournalRetirements, RuntimeRetirement>();
/** Monotonic removed-writer authority; no create/start/force/file effects or transport-close inference. */
export class RuntimeRetirement {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly options: RuntimeRetirementOptions;
  constructor(options: RuntimeRetirementOptions) {
    ownedDaemon(options);
    if (owners.has(options.journal.retirements)) throw new RuntimeRetirementError('capacity');
    this.options = Object.freeze({ ...options }); owners.set(options.journal.retirements, this);
  }
  status() { return Object.freeze({ retained: this.entries.size, closed: this.closed }); }
  retire(producer: ProducerBarrier, input: Operation): Promise<RuntimeAbsent> {
    if (this.closed) return Promise.reject(new RuntimeRetirementError('closed'));
    let intent: ReturnType<typeof producerIntent>;
    try { intent = producerIntent(this.options, producer); } catch { return Promise.reject(new RuntimeRetirementError('conflict')); }
    const id = encodeCanonicalJson(runtimeKey(intent), 640);
    let entry: Entry;
    try { entry = this.reserve(id, intent.requestDigest); } catch (error) { return Promise.reject(error); }
    if (entry.active) return entry.active;
    const owner = entry; owner.starting = true; let operation: Operation;
    try { operation = captureWindow(input); }
    catch (error) { owner.starting = false; if (!entry.backend) this.entries.delete(id); return Promise.reject(error); }
    owner.abort = new AbortController();
    operation = Object.freeze({ deadline: operation.deadline, signal: operation.signal
      ? AbortSignal.any([operation.signal, owner.abort.signal]) : owner.abort.signal });
    const active = Promise.resolve().then(async () => {
      const check = () => { checkWindow(operation, this.closed); producerIntent(this.options, producer); };
      check(); const runtime = await releasedRuntime({ options: this.options, intent, check }); check();
      const daemonId = ownedDaemon(this.options);
      if (runtime) {
        owner.backend ??= this.options.backend(); check();
        const result = await owner.backend.removeRetired(runtime.plan, operation, { runtimeId: runtime.runtimeId, daemonId }); check();
        if (result.outcome !== 'known') throw new RuntimeRetirementError('unresolved');
      } else await this.noRuntimeDaemon(operation, daemonId, check);
      check(); const facts: RuntimeAbsentFacts = { intent, daemonId, runtime: runtime
        ? { kind: 'absent', runtimeId: runtime.runtimeId, specDigest: runtime.specDigest } : { kind: 'never_started' } };
      const token = mintRuntimeAbsent({ facts, producer, journal: this.options.journal.retirements, open: () => !this.closed });
      this.entries.delete(id); return token;
    });
    owner.active = active; owner.starting = false;
    void active.then(() => { delete owner.active; delete owner.abort; }, () => {
      delete owner.active; delete owner.abort; if (!owner.backend) this.entries.delete(id);
    }); return active;
  }
  private reserve(id: string, digest: string): Entry {
    const entry = this.entries.get(id);
    if (entry) {
      if (entry.digest !== digest) throw new RuntimeRetirementError('conflict');
      if (entry.starting) throw new RuntimeRetirementError('capacity'); return entry;
    }
    if (this.entries.size >= 64) throw new RuntimeRetirementError('capacity');
    const created: Entry = { digest, starting: false }; this.entries.set(id, created); return created;
  }
  private async noRuntimeDaemon(operation: Operation, daemonId: string, check: () => void): Promise<void> {
    const version = await this.options.transport.request({ ...operation, method: 'GET', path: '/version' }); check();
    const info = await this.options.transport.request({ ...operation, method: 'GET', path: '/v1.47/info' }); check();
    if (!daemonResources(version, info, daemonId).ok) throw new RuntimeRetirementError('conflict');
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    for (const entry of this.entries.values()) entry.abort?.abort();
    this.closing = Promise.resolve().then(async () => {
      await Promise.allSettled([...this.entries.values()].map(entry => entry.active));
      if (this.entries.size) throw new RuntimeRetirementError('unresolved');
    });
    return this.closing;
  }
}
