import { createRunLiveMetricsService } from '../application/run-live-metrics/index.js';
import { registerRunLiveMetricRoutes } from '../adapters/inbound/http/run-live-metrics/index.js';
import { createRunMetricsService } from '../application/run-metrics/index.js';
import { registerRunMetricRoutes } from '../adapters/inbound/http/run-metrics/index.js';
import { registerRunArtifactRoutes } from '../adapters/inbound/http/run-artifacts/index.js';
import { captureAgentRuntime, agentMetadata, openAgentRuntime } from './agent-runtime.js';
import type { AgentRuntime, AgentRuntimeOptions } from './agent-runtime.js';
import type { RuntimePollerState } from './runtime-poller.js';
import { closeApplicationStore, throwCloseFailures } from './application-close.js';
import { registerSuiteRoutes } from '../adapters/inbound/http/suites/index.js';
import { registerRunRoutes } from '../adapters/inbound/http/runs/index.js';
import { createHash, randomUUID } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';
import { API_MAXIMUM_JSON_BYTES, apiSchemas } from '@beetle/contracts/api';
import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import { createApiServer } from '../adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../adapters/inbound/http/schema-compilers.js';
import { registerNamespaceRoutes } from '../adapters/inbound/http/namespaces/index.js';
import { registerSettingsRoutes } from '../adapters/inbound/http/settings/index.js';
import { createLocalSession } from '../adapters/inbound/http/session/index.js';
import { openMetadata } from '../adapters/outbound/sqlite/index.js';
import type { Metadata, MetadataOptions, RuntimeObservation } from '../adapters/outbound/sqlite/index.js';
import { classifyMetadataError } from './metadata-errors.js';
import { openInputRuntime } from './input-runtime.js';
import type { InputRuntime } from './input-runtime.js';
import type { InputMaintenanceState } from './input-maintenance.js';
import { registerInputRoutes } from '../adapters/inbound/http/inputs/index.js';
import type { InputHttp } from '../adapters/inbound/http/inputs/index.js';

export interface ApplicationOptions {
  readonly externalOrigin: string;
  readonly metadata: MetadataOptions;
  readonly agent?: AgentRuntimeOptions;
  /** Canonical installation-owned child of the private data directory. */
  readonly inputsDirectory?: string;
}
export interface Application {
  readonly server: FastifyInstance;
  /** For explicit local startup output only; never an HTTP response. */
  readonly bootstrapToken: string;
  readonly updateRuntime: (observation: RuntimeObservation | null) => Promise<null>;
  readonly inputRecoveryState: () => InputMaintenanceState | 'disabled';
  readonly runtimeState: () => RuntimePollerState | 'disabled';
  readonly close: () => Promise<void>;
}
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Local session, authoring and installation-owned input composition. */
export async function openApplication(options: ApplicationOptions): Promise<Application> {
  const { externalOrigin, metadata: metadataOptions, inputsDirectory, agent: requestedAgent } = options;
  const agent = requestedAgent === undefined ? undefined : captureAgentRuntime(requestedAgent, metadataOptions, inputsDirectory);
  const configuredMetadata = agentMetadata(metadataOptions, agent);
  const session = createLocalSession({ externalOrigin });
  const server = createApiServer({ classify: classifyMetadataError });
  let metadata: Metadata | undefined;
  let agentRuntime: AgentRuntime | undefined;
  let metricHttp: {close(): Promise<void>} | undefined;
  let artifactHttp: {close(): Promise<void>} | undefined;
  const closeMetrics = () => metricHttp?.close();
  let inputRuntime: InputRuntime | undefined; let inputHttp: InputHttp | undefined;
  try {
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES });
    metadata = await openMetadata(configuredMetadata);
    const store = metadata;
    if (inputsDirectory !== undefined) inputRuntime = await openInputRuntime(inputsDirectory, store.inputs);
    if (agent) agentRuntime = await openAgentRuntime(agent, store);
    session.registerRoutes(server);
    registerNamespaceRoutes(server, { store: store.namespaces, reader: store, newId: randomUUID,
      digest, authorize: session.authorize });
    registerSuiteRoutes(server, { store: store.suites, reader: store.suites, newId: randomUUID, digest, authorize: session.authorize });
    registerRunRoutes(server, { store: store.runs, reader: store.runs, resultReader: store.results, eventReader: store.runEvents, newId: randomUUID, digest,
      now: () => new Date().toISOString(), authorize: session.authorize });
    artifactHttp = registerRunArtifactRoutes(server, {reader: store.runArtifacts, authorize: session.authorize,
      ...(agentRuntime?.publishedBytes ? {bytes: agentRuntime.publishedBytes} : {})});
    metricHttp = metricRoutes(server, store, agentRuntime, session.authorize);
    registerSettingsRoutes(server, { store: store.settings, reader: store, digest, authorize: session.authorize });
    if (inputRuntime) inputHttp = registerInputRoutes(server, { inputs: inputRuntime.inputs, newId: randomUUID, authorize: session.authorize });
    server.addHook('onClose', async () => {
      session.close();
      await closeMetrics();
      await artifactHttp?.close();
      await closeApplicationStore(agentRuntime, inputRuntime, store);
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      session.close();
      const metrics = closeMetrics();
      const downloads = artifactHttp?.close();
      if (!closing) {
        closing = Promise.resolve().then(async () => {
          const results = await Promise.allSettled([metrics, downloads, Promise.resolve().then(() => inputHttp?.close()),
            Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()),
            Promise.resolve().then(() => server.close())]);
          throwCloseFailures(results);
        });
      }
      return closing;
    };
    await server.ready();
    return Object.freeze({ server, bootstrapToken: session.bootstrapToken,
      inputRecoveryState: () => inputRuntime?.recoveryState() ?? 'disabled',
      runtimeState: () => agentRuntime?.state() ?? 'disabled',
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation), close });
  } catch (error) {
    session.close();
    const resources = await Promise.allSettled([closeMetrics(), artifactHttp?.close(), Promise.resolve().then(() => inputHttp?.close()),
      Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()), Promise.resolve().then(() => server.close())]);
    const store = await Promise.allSettled([metadata?.abort()]);
    throwCloseFailures([{ status: 'rejected', reason: error }, ...resources, ...store]);
    throw error;
  }
}
function metricRoutes(server: FastifyInstance, store: Metadata, agent: AgentRuntime | undefined, authorize: onRequestAsyncHookHandler) {
  const history = registerRunMetricRoutes(server, {authorize, service: createRunMetricsService({artifacts: store.runArtifacts,
    ...(agent?.publishedBytes ? {bytes: agent.publishedBytes} : {}),
    createDigest: () => {const hash = createHash('sha256'); return {update: bytes => {hash.update(bytes);}, hex: () => hash.digest('hex')};},
  })});
  const live = registerRunLiveMetricRoutes(server, {authorize, service: createRunLiveMetricsService({executions: store.executions,
    ...(agent?.liveMetrics ? {gateway: {liveMetrics: agent.liveMetrics}} : {}), hash: digest})});
  return {close: async () => {await Promise.all([history.close(), live.close()]);}};
}
