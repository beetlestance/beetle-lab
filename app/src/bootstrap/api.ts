import { registerStorageHealth } from './storage-health.js';
import { applicationMode } from './historical.js';
import type { HistoricalOptions } from './historical.js';
import type { BackendServingLease } from './recovery-control/index.js';
import { openBackendServing } from './recovery-control/index.js';
import { registerRetentionRoutes } from '../adapters/inbound/http/retention/index.js';
import { registerInstallationStatusRoutes } from '../adapters/inbound/http/installation-status/index.js';
import { openHistoryIndex } from './history-index.js';
import type { RunHistoryIndexerState } from '../ports/run-history.js';
import { registerOverviewRoute } from '../adapters/inbound/http/overview/index.js';
import { registerExportRoutes } from '../adapters/inbound/http/exports/index.js';
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
import { workspaceVisibility } from '../adapters/inbound/http/workspace-visibility.js';
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
  readonly onStorageFailure?: (error: unknown) => void;
  readonly configurationCheck?: () => Promise<void>;
  readonly externalOrigin: string;
  readonly historical?: HistoricalOptions;
  readonly recoveryControl?: { readonly path: string; readonly installationId: string };
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
  return new ApplicationOwner(options).open();
}

class ApplicationOwner {
  private readonly mode: ReturnType<typeof applicationMode>;
  private readonly inputsDirectory: ApplicationOptions['inputsDirectory'];
  private readonly agent: ReturnType<typeof captureAgentRuntime> | undefined;
  private readonly configuredMetadata: MetadataOptions;
  private readonly server: FastifyInstance;
  private recovery: BackendServingLease | undefined;
  private session: LocalSession | undefined;
  private metadata: Metadata | undefined;
  private agentRuntime: AgentRuntime | undefined;
  private metricHttp: ReturnType<typeof metricRoutes> | undefined;
  private artifactHttp: { close(): Promise<void> } | undefined;
  private historicalInputs: ReturnType<HistoricalOptions['openInputs']>;
  private inputRuntime: InputRuntime | undefined;
  private inputHttp: InputHttp | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: ApplicationOptions) {
    this.mode = applicationMode(options);
    const { externalOrigin, metadata: metadataOptions, inputsDirectory, agent: requestedAgent } = options;
    captureLocalAccess(options.localAccess);
    captureLocalExternalOrigin(externalOrigin);
    this.inputsDirectory = inputsDirectory;
    this.agent =
      requestedAgent === undefined ? undefined : captureAgentRuntime(requestedAgent, metadataOptions, inputsDirectory);
    this.configuredMetadata = agentMetadata(metadataOptions, this.agent);
    this.server = createApiServer({ classify: classifyMetadataError });
  }
  private closeSession() {
    return this.session?.close();
  }
  private closeMetrics() {
    return this.metricHttp?.close();
  }
  private closeArtifacts() {
    return this.artifactHttp?.close();
  }
  private readView() {
    return this.mode.reads(this.agentRuntime);
  }
  async open(): Promise<Application> {
    try {
      this.mode.protect(this.server);
      this.recovery = await servingControl(this.options);
      configureSchemaCompilers(this.server, {
        schemas: apiSchemas,
        encodeJson,
        maximumResponseBytes: API_MAXIMUM_JSON_BYTES,
      });
      this.metadata = await openMetadata({ ...this.configuredMetadata, onFailure: this.options.onStorageFailure });
      const store = this.metadata;
      this.session = await this.mode.session(store.localSessions);
      this.historicalInputs = this.mode.inputs(store.inputs);
      if (this.inputsDirectory !== undefined)
        this.inputRuntime = await openInputRuntime(this.inputsDirectory, store.inputs);
      if (this.agent) this.agentRuntime = await openAgentRuntime(this.agent, store);
      this.session.registerRoutes(this.server);
      const publicAuthorize = workspaceVisibility(this.session.authorize, store, this.mode.historical);
      registerAuthoring(this.server, store, publicAuthorize);
      this.artifactHttp = downloadRoutes(this.server, store, this.readView(), publicAuthorize);
      this.metricHttp = metricRoutes(this.server, store, this.readView(), publicAuthorize, this.mode.historical);
      registerRetentionRoutes(this.server, {
        driverState: () => this.agentRuntime?.cleanupState() ?? 'disabled',
        store: store.retention,
        newId: randomUUID,
        now: () => new Date().toISOString(),
        authorize: publicAuthorize,
      });
      registerInstallationStatusRoutes(this.server, {
        reader: store.installationStatus,
        agent: () => this.agentRuntime?.agentStatus?.() ?? null,
        authorize: publicAuthorize,
        nowMs: () => Date.now(),
      });
      const inputs = readInputs(this.historicalInputs, this.inputRuntime);
      if (inputs)
        this.inputHttp = registerInputRoutes(this.server, { inputs, newId: randomUUID, authorize: publicAuthorize });
      this.server.addHook('onClose', async () => {
        this.closeSession();
        const readers = await Promise.allSettled([
          Promise.resolve().then(() => this.inputHttp?.close()),
          this.closeMetrics(),
          this.closeArtifacts(),
        ]);
        const storage = await Promise.allSettled([closeApplicationStore(this.agentRuntime, this.inputRuntime, store)]);
        throwCloseFailures([...readers, ...storage]);
        await this.historicalInputs?.close();
        await this.mode.close();
        this.recovery?.close();
      });
      return await this.finish(store, this.session!);
    } catch (error) {
      return this.failed(error);
    }
  }
  private async finish(store: Metadata, session: LocalSession): Promise<Application> {
    registerStorageHealth(this.server, () =>
      store.storageStatus() === 'unavailable' ? 'unavailable' : this.closing ? 'closing' : store.storageStatus(),
    );
    await this.server.ready();
    return Object.freeze({
      server: this.server,
      bootstrapToken: session.bootstrapToken,
      inputRecoveryState: () => this.inputRuntime?.recoveryState() ?? 'disabled',
      runtimeState: () => this.agentRuntime?.state() ?? 'disabled',
      historySummaryState: () => this.metricHttp?.historySummaryState() ?? 'disabled',
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation),
      close: () => this.close(),
    });
  }
  private close(): Promise<void> {
    this.closeSession();
    const metrics = this.closeMetrics();
    const downloads = this.closeArtifacts();
    if (!this.closing) {
      this.closing = Promise.resolve().then(async () => {
        const readers = await Promise.allSettled([metrics, downloads]);
        const results = await Promise.allSettled([
          Promise.resolve().then(() => this.inputHttp?.close()),
          Promise.resolve().then(() => this.agentRuntime?.close()),
          Promise.resolve().then(() => this.inputRuntime?.close()),
          Promise.resolve().then(() => this.server.close()),
        ]);
        throwCloseFailures([...readers, ...results]);
      });
    }
    return this.closing;
  }
  private async failed(error: unknown): Promise<never> {
    this.closeSession();
    const readers = await Promise.allSettled([this.closeMetrics(), this.closeArtifacts()]);
    const resources = await Promise.allSettled([
      Promise.resolve().then(() => this.inputHttp?.close()),
      Promise.resolve().then(() => this.agentRuntime?.close()),
      Promise.resolve().then(() => this.inputRuntime?.close()),
      Promise.resolve().then(() => this.server.close()),
    ]);
    const store = await Promise.allSettled([this.metadata?.abort()]);
    try {
      throwCloseFailures([...readers, ...resources, ...store]);
      await this.historicalInputs?.close();
      await this.mode.close();
      this.recovery?.close();
    } catch (cleanup) {
      throwCloseFailures([
        { status: 'rejected', reason: error },
        { status: 'rejected', reason: cleanup },
      ]);
    }
    throw error;
  }
}

type ReadView = Partial<Pick<AgentRuntime, 'publishedBytes' | 'liveMetrics'>>;
function metricRoutes(
  server: FastifyInstance,
  store: Metadata,
  agent: ReadView | undefined,
  authorize: onRequestAsyncHookHandler,
  historical: boolean,
) {
  const historyService = createRunMetricsService({
    artifacts: store.runArtifacts,
    ...(agent?.publishedBytes ? { bytes: agent.publishedBytes } : {}),
    createDigest: () => {
      const hash = createHash('sha256');
      return {
        update: (bytes) => {
          hash.update(bytes);
        },
        hex: () => hash.digest('hex'),
      };
    },
  });
  const index = openHistoryIndex(store, historical ? undefined : agent?.publishedBytes, async (problem) => {
    server.log.error({ code: 'history_summary_index_failure', problem }, 'History summary indexing failed');
  });
  const history = registerRunMetricRoutes(server, { authorize, service: historyService });
  const comparisons = registerRunComparisonRoutes(server, {
    authorize,
    service: createRunComparisonService({
      runs: store.runs,
      results: store.results,
      suites: store.suites,
      metrics: historyService,
      digest,
    }),
  });
  const live = registerRunLiveMetricRoutes(server, {
    authorize,
    service: createRunLiveMetricsService({
      executions: store.executions,
      ...(agent?.liveMetrics ? { gateway: { liveMetrics: agent.liveMetrics } } : {}),
      hash: digest,
      monotonic: () => performance.now(),
    }),
  });
  return {
    historySummaryState: index.state,
    close: async () => {
      throwCloseFailures(await Promise.allSettled([index.close(), history.close(), live.close(), comparisons.close()]));
    },
  };
}

function downloadRoutes(
  server: FastifyInstance,
  store: Metadata,
  agent: ReadView | undefined,
  authorize: onRequestAsyncHookHandler,
) {
  const bytes = agent?.publishedBytes;
  const runs = registerRunArtifactRoutes(server, {
    reader: store.runArtifacts,
    authorize,
    ...(bytes ? { bytes } : {}),
  });
  const exports = registerExportRoutes(server, {
    store: store.exports,
    outputs: store.exportOutputs,
    newId: randomUUID,
    digest,
    now: () => new Date().toISOString(),
    authorize,
    ...(bytes ? { bytes } : {}),
  });
  return {
    close: async () => {
      throwCloseFailures(await Promise.allSettled([runs.close(), exports.close()]));
    },
  };
}

function registerAuthoring(server: FastifyInstance, store: Metadata, authorize: onRequestAsyncHookHandler): void {
  registerNamespaceRoutes(server, {
    deletions: store.namespaceDeletions,
    store: store.namespaces,
    reader: store,
    newId: randomUUID,
    digest,
    authorize: authorize,
  });
  registerSuiteRoutes(server, {
    store: store.suites,
    reader: store.suites,
    newId: randomUUID,
    digest,
    now: () => new Date().toISOString(),
    authorize: authorize,
  });
  registerOverviewRoute(server, {
    reader: store.overview,
    organizationReader: store.organizationOverview,
    authorize: authorize,
    now: () => new Date().toISOString(),
  });
  registerRunRoutes(server, {
    store: store.runs,
    reader: store.runs,
    resultReader: store.results,
    eventReader: store.runEvents,
    newId: randomUUID,
    digest,
    now: () => new Date().toISOString(),
    authorize: authorize,
  });
  registerSettingsRoutes(server, { store: store.settings, reader: store, digest, authorize });
}

async function servingControl(options: ApplicationOptions): Promise<BackendServingLease | undefined> {
  const control = options.recoveryControl;
  const lease = control ? openBackendServing(control.path, control.installationId) : undefined;
  try {
    await options.configurationCheck?.();
    return lease;
  } catch (error) {
    lease?.close();
    throw error;
  }
}
function readInputs(history: ReturnType<HistoricalOptions['openInputs']>, runtime: InputRuntime | undefined) {
  return history ?? runtime?.inputs;
}
