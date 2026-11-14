import { applicationMode } from './historical.js';
import type { HistoricalOptions } from './historical.js';
import type { BackendServingLease } from './recovery-control/index.js';
import { openBackendServing } from './recovery-control/index.js';
import { registerRetentionRoutes } from '../adapters/inbound/http/retention/index.js';
import { openHistoryIndex } from './history-index.js';
import type { RunHistoryIndexerState } from '../ports/run-history.js';
import {registerOverviewRoute} from '../adapters/inbound/http/overview/index.js';
import {registerExportRoutes} from '../adapters/inbound/http/exports/index.js';
import type { LocalSession } from '../adapters/inbound/http/session/index.js';
import { captureLocalAccess } from './local-access.js';
import { createRunComparisonService } from '../application/run-comparison/index.js';
import { registerRunComparisonRoutes } from '../adapters/inbound/http/run-comparison/index.js';
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
import { captureLocalExternalOrigin } from '../adapters/inbound/http/session/index.js';
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
  readonly historical?: HistoricalOptions;
  readonly recoveryControl?: {readonly path: string; readonly installationId: string};
  readonly localAccess?: 'paired' | 'automatic';
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
  readonly historySummaryState: () => RunHistoryIndexerState | 'disabled';
  readonly close: () => Promise<void>;
}
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Local session, authoring and installation-owned input composition. */
export async function openApplication(options: ApplicationOptions): Promise<Application> {
  const mode = applicationMode(options);
  const { externalOrigin, metadata: metadataOptions, inputsDirectory, agent: requestedAgent } = options;
  captureLocalAccess(options.localAccess);
  captureLocalExternalOrigin(externalOrigin);
  const agent = requestedAgent === undefined ? undefined : captureAgentRuntime(requestedAgent, metadataOptions, inputsDirectory);
  const configuredMetadata = agentMetadata(metadataOptions, agent);
  let recovery: BackendServingLease | undefined;
  let session: LocalSession | undefined;
  const closeSession = () => session?.close();
  const server = createApiServer({ classify: classifyMetadataError });
  let metadata: Metadata | undefined;
  let agentRuntime: AgentRuntime | undefined;
  let metricHttp: ReturnType<typeof metricRoutes> | undefined;
  let artifactHttp: {close(): Promise<void>} | undefined;
  const closeArtifacts=()=>artifactHttp?.close();
  const closeMetrics = () => metricHttp?.close();
  let historicalInputs: ReturnType<HistoricalOptions['openInputs']>;
  const readView = () => mode.reads(agentRuntime);
  let inputRuntime: InputRuntime | undefined; let inputHttp: InputHttp | undefined;
  try {
    mode.protect(server);
    recovery = servingControl(options.recoveryControl);
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES });
    metadata = await openMetadata(configuredMetadata);
    const store = metadata;
    session = await mode.session(store.localSessions); historicalInputs = mode.inputs(store.inputs);
    if (inputsDirectory !== undefined) inputRuntime = await openInputRuntime(inputsDirectory, store.inputs);
    if (agent) agentRuntime = await openAgentRuntime(agent, store);
    session.registerRoutes(server);
    registerAuthoring(server, store, session.authorize);
    artifactHttp=downloadRoutes(server,store,readView(),session.authorize);
    metricHttp = metricRoutes(server, store, readView(), session.authorize, mode.historical);
    registerRetentionRoutes(server,{driverState:()=>agentRuntime?.cleanupState()??'disabled',store:store.retention,newId:randomUUID,now:()=>new Date().toISOString(),authorize:session.authorize});
    const inputs = readInputs(historicalInputs, inputRuntime);
    if (inputs) inputHttp = registerInputRoutes(server, { inputs, newId: randomUUID, authorize: session.authorize });
    server.addHook('onClose', async () => {
      closeSession();
      const readers = await Promise.allSettled([Promise.resolve().then(() => inputHttp?.close()), closeMetrics(), closeArtifacts()]);
      const storage = await Promise.allSettled([closeApplicationStore(agentRuntime, inputRuntime, store)]);
      throwCloseFailures([...readers, ...storage]);
      await historicalInputs?.close(); await mode.close(); recovery?.close();
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closeSession();
      const metrics = closeMetrics();
      const downloads = closeArtifacts();
      if (!closing) {
        closing = Promise.resolve().then(async () => {
          const readers = await Promise.allSettled([metrics, downloads]);
          const results = await Promise.allSettled([Promise.resolve().then(() => inputHttp?.close()),
            Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()),
            Promise.resolve().then(() => server.close())]);
          throwCloseFailures([...readers, ...results]);
        });
      }
      return closing;
    };
    await server.ready();
    return Object.freeze({ server, bootstrapToken: session.bootstrapToken,
      inputRecoveryState: () => inputRuntime?.recoveryState() ?? 'disabled',
      runtimeState: () => agentRuntime?.state() ?? 'disabled',
      historySummaryState: () => metricHttp?.historySummaryState() ?? 'disabled',
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation), close });
  } catch (error) {
    closeSession();
    const readers = await Promise.allSettled([closeMetrics(), closeArtifacts()]);
    const resources = await Promise.allSettled([Promise.resolve().then(() => inputHttp?.close()),
      Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()), Promise.resolve().then(() => server.close())]);
    const store = await Promise.allSettled([metadata?.abort()]);
    try {throwCloseFailures([...readers, ...resources, ...store]); await historicalInputs?.close(); await mode.close(); recovery?.close();}
    catch (cleanup) {throwCloseFailures([{status: 'rejected', reason: error}, {status: 'rejected', reason: cleanup}]);}
    throw error;
  }
}
type ReadView = Partial<Pick<AgentRuntime, 'publishedBytes' | 'liveMetrics'>>;
function metricRoutes(server: FastifyInstance, store: Metadata, agent: ReadView | undefined, authorize: onRequestAsyncHookHandler, historical: boolean) {
  const historyService = createRunMetricsService({artifacts: store.runArtifacts,
    ...(agent?.publishedBytes ? {bytes: agent.publishedBytes} : {}),
    createDigest: () => {const hash = createHash('sha256'); return {update: bytes => {hash.update(bytes);}, hex: () => hash.digest('hex')};},
  });
  const index = openHistoryIndex(store, historical ? undefined : agent?.publishedBytes, async problem => {
    server.log.error({ code: 'history_summary_index_failure', problem }, 'History summary indexing failed');
  });
  const history = registerRunMetricRoutes(server, {authorize, service: historyService});
  const comparisons = registerRunComparisonRoutes(server, {authorize, service: createRunComparisonService({runs: store.runs,
    results: store.results, suites: store.suites, metrics: historyService, digest})});
  const live = registerRunLiveMetricRoutes(server, {authorize, service: createRunLiveMetricsService({executions: store.executions,
    ...(agent?.liveMetrics ? {gateway: {liveMetrics: agent.liveMetrics}} : {}), hash: digest})});
  return { historySummaryState: index.state, close: async () => {
    throwCloseFailures(await Promise.allSettled([index.close(), history.close(), live.close(), comparisons.close()]));
  } };
}

function downloadRoutes(server:FastifyInstance,store:Metadata,agent:ReadView|undefined,authorize:onRequestAsyncHookHandler){
 const bytes=agent?.publishedBytes;
 const runs=registerRunArtifactRoutes(server,{reader:store.runArtifacts,authorize,...(bytes?{bytes}:{})});
 const exports=registerExportRoutes(server,{store:store.exports,outputs:store.exportOutputs,newId:randomUUID,digest,
  now:()=>new Date().toISOString(),authorize,...(bytes?{bytes}:{})});
 return {close:async()=>{throwCloseFailures(await Promise.allSettled([runs.close(),exports.close()]));}};
}

function registerAuthoring(server: FastifyInstance, store: Metadata, authorize: onRequestAsyncHookHandler): void {
    registerNamespaceRoutes(server, { deletions: store.namespaceDeletions, store: store.namespaces, reader: store, newId: randomUUID,
      digest, authorize: authorize });
    registerSuiteRoutes(server, { store: store.suites, reader: store.suites, newId: randomUUID, digest, authorize: authorize });
    registerOverviewRoute(server,{reader:store.overview,organizationReader:store.organizationOverview,authorize:authorize,now:()=>new Date().toISOString()});
    registerRunRoutes(server, { store: store.runs, reader: store.runs, resultReader: store.results, eventReader: store.runEvents, newId: randomUUID, digest,
      now: () => new Date().toISOString(), authorize: authorize });
    registerSettingsRoutes(server, { store: store.settings, reader: store, digest, authorize });
}

function servingControl(control: ApplicationOptions['recoveryControl']): BackendServingLease | undefined {
  return control ? openBackendServing(control.path, control.installationId) : undefined;
}
function readInputs(history: ReturnType<HistoricalOptions['openInputs']>, runtime: InputRuntime | undefined) {
  return history ?? runtime?.inputs;
}
