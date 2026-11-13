import {retireOutput} from './retirement.js';
import type {RunnerRetirementGateway} from '../../../ports/runner-retirement.js';
import type {RunnerExportGateway} from '../../../ports/export-runner.js';
import {createExportAttempt} from './export-attempt.js';
import { readLiveMetrics } from './live-metrics.js';
import { createRunnerClient, validatePrimitive } from '@beetle/contracts';
import type { LoadedAgentConfiguration, RunnerAttemptClient } from '../../../ports/runner.js';
import type { RunnerLiveMetricGateway } from '../../../ports/run-live-metrics.js';
import { captureIdentity } from './identity.js';
import { CallCredits } from './lifetime.js';
import type { NativeIo } from './native.js';
import { createTransport } from './transport.js';
import { createSourceClient } from './source.js';

function captureOrigin(originText: string): URL {
  const origin = new URL(originText);
  if (originText.length > 2048 || origin.protocol !== 'http:' || origin.username || origin.password) throw new Error();
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  return origin;
}

function capture(loaded: LoadedAgentConfiguration): { origin: URL; token: string; installationId: string } {
  try {
    const origin = captureOrigin(loaded.configuration.origin);
    const token = loaded.token;
    const installationId = loaded.configuration.expectedInstallationId;
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token) || !validatePrimitive('uuid', installationId).ok) throw new Error();
    return { origin, token, installationId };
  } catch { throw new Error('Invalid runner connection'); }
}

/** Internal composition seam; public construction always uses real Node I/O. */
export function openGateway(loaded: LoadedAgentConfiguration, io: NativeIo): RunnerLiveMetricGateway & RunnerExportGateway & RunnerRetirementGateway {
  const connection = { ...capture(loaded), credits: new CallCredits(), io };
  const client = createRunnerClient(createTransport(connection));
  return Object.freeze({
    retireOutput:(request,signal)=>retireOutput(connection,request,signal),
    exportAttempt:identity=>createExportAttempt(connection,identity),
    liveMetrics: (identity, signal) => readLiveMetrics(connection, captureIdentity(identity), signal),
    capabilities: (signal?: AbortSignal) => client.capabilities(signal),
    output: identity => createSourceClient(connection, captureIdentity(identity)),
    attempt: identity => {
      const captured = captureIdentity(identity);
      const scoped = createRunnerClient(createTransport(connection, captured));
      const facade: RunnerAttemptClient = {
        offer: (body, signal) => scoped.offer(captured.attemptId, body, signal),
        cancelOriginal: (body, signal) => scoped.cancelOriginal(captured.attemptId, body, signal),
        snapshot: signal => scoped.snapshot(captured.attemptId, signal),
        cancel: (body, signal) => scoped.cancel(captured.attemptId, body, signal),
        events: (after, signal) => scoped.events(captured.attemptId, after, signal),
        ack: (body, signal) => scoped.ack(captured.attemptId, body, signal),
      };
      return Object.freeze(facade);
    },
    close: () => connection.credits.close(),
  } satisfies RunnerLiveMetricGateway & RunnerExportGateway & RunnerRetirementGateway);
}
