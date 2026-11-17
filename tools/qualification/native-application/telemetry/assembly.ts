import assert from 'node:assert/strict';
import {
  verifyInstallation,
  NamespaceBinding,
  boundRootNamespace,
  Stager,
} from '../../../../agent/src/staging/index.js';
import { openJournal } from '../../../../agent/src/journal/index.js';
import { ProducerGate } from '../../../../agent/src/producer-gate/index.js';
import { createOutputGuard } from '../../../../agent/src/guard/index.js';
import { createTimeoutGuard } from '../../../../agent/src/timeout/index.js';
import { createResourceObserver, createObservationPublisher } from '../../../../agent/src/observation/index.js';
import { addResources } from '../../../../agent/src/admission/index.js';
import { Supervisor } from '../../../../agent/src/supervisor/index.js';
import { createInstallationController } from '../../../../agent/src/installation/index.js';
import type { InstallationController } from '../../../../agent/src/installation/index.js';
import type { AgentRuntimeOptions } from '../../../../agent/src/bootstrap/index.js';
import { installedLiveMetricApproval } from '../../../../agent/src/bootstrap/live-metrics.js';
import { catalog, backend } from './profile.js';
import { baseline, ready } from './startup.js';
import type { Mode } from './config.js';
import { closeGroup, closeOrdered, retain } from './ownership.js';
import type { Closer } from './ownership.js';
/** Qualification-only composition; installed startup and its required telemetry are untouched. */
export async function assemble(options: AgentRuntimeOptions, diagnostic: (value: unknown) => Promise<void>) {
  const closers: Closer[] = [];
  const slot: AssemblySlot = { current: undefined, closing: undefined };
  try {
    const verified = await verifyInstallation({
      configuration: options.installation,
      transport: options.transport,
      operation: { deadline: performance.now() + 30000 },
    });
    assert(verified.ok);
    const journal = await openJournal(options.journal);
    closers.unshift(() => journal.close());
    const namespace = new NamespaceBinding({
      root: verified.value,
      journal: journal.stagingNamespace,
      journalAuthority: await journal.journalAuthority(),
      operation: { deadline: performance.now() + 30000 },
    });
    closers.unshift(() => namespace.close());
    await namespace.bind();
    const on = catalog(options.catalog, 'on');
    const off = catalog(options.catalog, 'off');
    assert.deepEqual(
      on.engines.map((engine) => engine.approved),
      off.engines.map((engine) => engine.approved),
    );
    const configuration = { ...options.configuration, profiles: on.engines.map((engine) => engine.approved) };
    await journal.admission({ kind: 'configure', configuration });
    const gate = new ProducerGate({
      journal: journal.retirements,
      namespaceIdentity: boundRootNamespace(verified.value).namespaceIdentity,
    });
    closers.unshift(() => gate.close());
    const overhead = addResources(configuration.controlReserve, configuration.headroom);
    const stop = (
      key: Parameters<InstallationController['stop']>[0],
      reason: Parameters<InstallationController['stop']>[1],
    ) => {
      assert(slot.current, 'No idle assembly may request a stop');
      return slot.current.manager.stop(key, reason);
    };
    const output = createOutputGuard({
      root: verified.value,
      minimumFreeBytes: Math.max(options.minimumFreeBytes, overhead.outputBytes + overhead.stagingBytes),
      stop,
    });
    closers.unshift(() => output.close());
    const timeout = createTimeoutGuard({ stop });
    closers.unshift(() => timeout.close());
    const observer = createResourceObserver({ root: verified.value, transport: options.transport, configuration });
    closers.unshift(() => observer.close());
    const publisher = createObservationPublisher({ journal, observer, output, timeout });
    closers.unshift(() => publisher.close());
    output.start();
    timeout.start();
    publisher.start();
    await readinessWithDiagnostics(publisher, async () => {
      await diagnostic({
        output: output.status(),
        timeout: timeout.status(),
        publisher: publisher.status(),
        baseline: await baseline(verified.value, options.transport),
      });
    });
    return createAssemblyHandle(
      { options, on, off, journal, configuration, gate, output, timeout, root: verified.value },
      closers,
      slot,
    );
  } catch (error) {
    try {
      await closeOrdered(closers);
    } catch (close) {
      retain({ current: slot.current, closers });
      throw new AggregateError([error, close], 'Telemetry assembly failed', { cause: close });
    }
    throw error;
  }
}
export type Assembly = Awaited<ReturnType<typeof assemble>>;
export type Trial = Awaited<ReturnType<Assembly['trial']>>;

interface AssemblySlot {
  current: { manager: InstallationController; close(): Promise<void> } | undefined;
  closing: Promise<void> | undefined;
}
interface AssemblyContext {
  options: AgentRuntimeOptions;
  on: ReturnType<typeof catalog>;
  off: ReturnType<typeof catalog>;
  journal: Awaited<ReturnType<typeof openJournal>>;
  configuration: AgentRuntimeOptions['configuration'];
  root: Parameters<typeof baseline>[0];
  gate: ProducerGate;
  output: ReturnType<typeof createOutputGuard>;
  timeout: ReturnType<typeof createTimeoutGuard>;
}

async function createTelemetryTrial(context: AssemblyContext, slot: AssemblySlot, mode: Mode) {
  assert(!slot.current && !slot.closing);
  const selected = mode === 'on' ? context.on : context.off;
  const engine = selected.engines[0]!;
  const supervisor = new Supervisor({
    journal: context.journal,
    installationId: context.options.installation.installationId,
    requireResourceTelemetry: mode === 'on',
    ...(mode === 'on' ? { liveMetricApproval: installedLiveMetricApproval(selected) } : {}),
    backendFactory: () => backend(context.options.transport, mode),
  });
  const stager = new Stager({
    gate: context.gate,
    root: context.root,
    journal: context.journal,
    profile: engine.profile,
    manifest: engine.manifest,
    validation: engine.validation,
    providers: context.options.providers,
  });
  const manager = createInstallationController({
    gate: context.gate,
    journal: context.journal,
    catalog: selected,
    supervisor,
    guard: context.output,
    timeout: context.timeout,
    stagerFor: () => stager,
  });
  let closed: Promise<void> | undefined;
  const owner = {
    manager,
    supervisor,
    stager,
    engine,
    close() {
      closed ??= closeGroup([() => manager.close(), () => supervisor.closeTelemetry(), () => stager.close()])
        .then(() => {
          slot.current = undefined;
        })
        .catch((error) => {
          retain(owner);
          throw error;
        });
      return closed;
    },
  };
  slot.current = owner;
  return owner;
}

function createAssemblyHandle(context: AssemblyContext, closers: Closer[], slot: AssemblySlot) {
  return {
    journal: context.journal,
    configuration: context.configuration,
    root: context.root,
    trial: (mode: Mode) => createTelemetryTrial(context, slot, mode),
    close() {
      slot.closing ??= (async () => {
        await slot.current?.close();
        await closeOrdered(closers);
      })().catch((error) => {
        retain({ current: slot.current, closers });
        throw error;
      });
      return slot.closing;
    },
  };
}

async function readinessWithDiagnostics(
  publisher: ReturnType<typeof createObservationPublisher>,
  diagnostic: () => Promise<void>,
): Promise<void> {
  try {
    await ready(publisher);
  } catch (error) {
    try {
      await diagnostic();
    } catch (diagnosticError) {
      throw new AggregateError([error, diagnosticError], 'Readiness and diagnostic failed', { cause: diagnosticError });
    }
    throw error;
  }
}
