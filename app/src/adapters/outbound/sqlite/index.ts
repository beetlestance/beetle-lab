import { exportArtifactClient, exportExecutionClient, exportJobClient } from './export-clients.js';
import { MetadataWorker } from './metadata-worker.js';
import { validateOptions } from './options.js';
import type { MetadataOptions } from './options.js';
import {
  checkedOrganizationOverview,
  checkedOrganizationOverviewQuery,
} from '../../../application/organization-overview/index.js';
import type { NamespaceDeletionStore } from '../../../ports/namespace-deletion.js';
import { retentionClient } from './retention-wire/index.js';
import type { RetentionOperation, RetentionMetadata } from '../../../ports/retention.js';
import type {
  OutputSettlementMetadata,
  BackendSettlementOperation,
} from '../../../ports/output-settlement-metadata.js';
import type { HistoryOperation } from './run-history/index.js';
import type { RunHistoryStore } from '../../../ports/run-history.js';
import { checkedOverview, checkedOverviewQuery } from '../../../application/overview/index.js';
import type { OverviewReader, OrganizationOverviewReader } from '../../../ports/overview.js';
import type { ExportArtifacts, ExportExecutionStore, ExportStore } from '../../../ports/exports.js';
import type { LocalSessionStore } from '../../../ports/local-session.js';
import type { OutputDeletionMetadata, OutputDeletionOperation } from '../../../ports/output-deletion-metadata.js';
import type { RunExecutionReader } from '../../../ports/run-live-metrics.js';
import type { RunArtifactsReader } from '../../../ports/run-artifacts.js';
import type { RunEventReader } from '../../../ports/run-events.js';
import type { OutputAbsenceStore } from '../../../ports/output-absence.js';
import type { OutputFinalizations } from '../../../ports/output-finalization.js';
import type { RunResultReader } from '../../../ports/run-results.js';
import type { OutputArtifactStore } from '../../../ports/output-artifacts.js';
import type { EventCustodyStore } from '../../../ports/events.js';
import type { RunStore, RunReader, RunCancellationStore } from '../../../ports/runs.js';
import type { DispatchStore } from '../../../ports/dispatch.js';
import type { InstallationStatusReader } from '../../../ports/installation-status.js';
import type { InputStore } from '../../../ports/inputs.js';
import type { SuiteStore, SuiteReader } from '../../../ports/suites.js';
import type { SettingsScope } from '@beetle/contracts/api';
import type { NamespaceStore } from '../../../ports/namespaces.js';
import type { NamespaceEntity } from '../../../ports/namespaces.js';
import type { SettingsStore } from '../../../ports/settings.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import { StorageError } from './protocol.js';
import type {
  Bootstrap,
  EntityKey,
  EntityPage,
  ListQuery,
  RuntimeObservation,
  SettingsView,
  Value,
} from './protocol.js';

export { StorageError } from './protocol.js';

export type { RunConfiguration, RunProfilePin } from '../../../ports/runs.js';

export type {
  Bootstrap,
  EntityKey,
  EntityPage,
  ErrorCode,
  ListQuery,
  RuntimeObservation,
  SettingsView,
} from './protocol.js';

export type { MetadataOptions } from './options.js';

/** Feature port composition over one owned metadata connection. */
export class Metadata extends MetadataWorker {
  readonly historySummaries: RunHistoryStore = {
    retirement: (job) =>
      this.historyCall({ kind: 'historySummary', operation: { method: 'retirement', request: { job } } }) as ReturnType<
        RunHistoryStore['retirement']
      >,
    scan: (query) =>
      this.historyCall({ kind: 'historySummary', operation: { method: 'scan', query } }) as ReturnType<
        RunHistoryStore['scan']
      >,
    defer: (request) =>
      this.historyCall({ kind: 'historySummary', operation: { method: 'defer', request } }) as ReturnType<
        RunHistoryStore['defer']
      >,
    commit: (request) =>
      this.historyCall({ kind: 'historySummary', operation: { method: 'commit', request } }) as ReturnType<
        RunHistoryStore['commit']
      >,
  };

  private async historyCall(operation: HistoryOperation): Promise<Value> {
    try {
      return await this.call(operation);
    } catch (error) {
      if (this.failed) {
        try {
          await this.terminate();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'History carrier termination failed', { cause: cleanup });
        }
      }
      throw error;
    }
  }

  readonly exportOutputs: ExportArtifacts = exportArtifactClient((operation) => this.call(operation));

  readonly exportExecutions: ExportExecutionStore = exportExecutionClient((operation) => this.call(operation));

  readonly exports: ExportStore = exportJobClient((operation) => this.call(operation));

  private async retentionCall(operation: RetentionOperation): Promise<Value> {
    try {
      return await this.call(operation);
    } catch (error) {
      if (this.failed) {
        try {
          await this.terminate();
        } catch {
          return await new Promise<never>(() => {});
        }
      }
      throw error;
    }
  }

  readonly retention: RetentionMetadata = retentionClient((operation) => this.retentionCall(operation));

  readonly localSessions: LocalSessionStore = {
    load: () => this.call({ kind: 'loadLocalSession' }) as ReturnType<LocalSessionStore['load']>,
    save: (expectedVersion, session) =>
      this.call({ kind: 'saveLocalSession', expectedVersion, session }) as ReturnType<LocalSessionStore['save']>,
  };

  readonly outputSettlements: OutputSettlementMetadata = {
    settle: (request) =>
      this.settlementCall({ kind: 'settleBackendOutput', request }) as ReturnType<OutputSettlementMetadata['settle']>,
    read: (key) =>
      this.settlementCall({ kind: 'readBackendSettlement', key }) as ReturnType<OutputSettlementMetadata['read']>,
  };

  private async settlementCall(operation: BackendSettlementOperation): Promise<Value> {
    try {
      return await this.call(operation);
    } catch (error) {
      if (this.failed) {
        try {
          await this.terminate();
        } catch {
          return await new Promise<never>(() => {});
        }
      }
      throw error;
    }
  }

  readonly outputDeletions: OutputDeletionMetadata = {
    begin: (command) =>
      this.deletionCall({ kind: 'beginOutputDeletion', command }) as ReturnType<OutputDeletionMetadata['begin']>,
    get: (key) => this.deletionCall({ kind: 'getOutputDeletion', key }) as ReturnType<OutputDeletionMetadata['get']>,
    cleanupAck: (key) =>
      this.deletionCall({ kind: 'getOutputCleanupAck', key }) as ReturnType<OutputDeletionMetadata['cleanupAck']>,
    recordCleanupAck: (request) =>
      this.deletionCall({ kind: 'recordOutputCleanupAck', request }) as ReturnType<
        OutputDeletionMetadata['recordCleanupAck']
      >,
    reserveControl: (key) =>
      this.deletionCall({ kind: 'reserveOutputCleanupControl', key }) as ReturnType<
        OutputDeletionMetadata['reserveControl']
      >,
    retirementRequest: (key) =>
      this.deletionCall({ kind: 'getOutputRetirementRequest', key }) as ReturnType<
        OutputDeletionMetadata['retirementRequest']
      >,
    getFile: (key) =>
      this.deletionCall({ kind: 'getOutputDeletionFile', key }) as ReturnType<OutputDeletionMetadata['getFile']>,
    recordPlan: (request) =>
      this.deletionCall({ kind: 'recordOutputDeletionPlan', request }) as ReturnType<
        OutputDeletionMetadata['recordPlan']
      >,
    recordAbsence: (request) =>
      this.deletionCall({ kind: 'recordOutputDeletionAbsence', request }) as ReturnType<
        OutputDeletionMetadata['recordAbsence']
      >,
    scanSettlements: (query) =>
      this.deletionCall({ kind: 'scanOutputSettlements', query }) as ReturnType<
        OutputDeletionMetadata['scanSettlements']
      >,
    scanRetirements: (query) =>
      this.deletionCall({ kind: 'scanOutputRetirements', query }) as ReturnType<
        OutputDeletionMetadata['scanRetirements']
      >,
    scan: (query) =>
      this.deletionCall({ kind: 'scanOutputDeletions', query }) as ReturnType<OutputDeletionMetadata['scan']>,
  };

  /** Failed replies do not settle the actual metadata carrier. */
  private async deletionCall(operation: OutputDeletionOperation): Promise<Value> {
    try {
      return await this.call(operation);
    } catch (error) {
      if (this.failed) {
        try {
          await this.terminate();
        } catch {
          return await new Promise<never>(() => {});
        }
      }
      throw error;
    }
  }

  readonly absences: OutputAbsenceStore = {
    read: (binding) => this.call({ kind: 'absenceRead', binding }) as ReturnType<OutputAbsenceStore['read']>,
    adopt: (request) => this.call({ kind: 'absenceAdopt', request }) as ReturnType<OutputAbsenceStore['adopt']>,
    finalize: (request) =>
      this.call({ kind: 'absenceFinalize', request }) as ReturnType<OutputAbsenceStore['finalize']>,
  };

  readonly finalizations: OutputFinalizations = {
    finalize: (request) =>
      this.call({ kind: 'outputFinalize', request }) as ReturnType<OutputFinalizations['finalize']>,
  };

  readonly runEvents: RunEventReader = {
    getRunEvents: (query) => this.call({ kind: 'getRunEvents', query }) as ReturnType<RunEventReader['getRunEvents']>,
  };

  readonly runArtifacts: RunArtifactsReader = {
    listRunArtifacts: (query) =>
      this.call({ kind: 'listRunArtifacts', query }) as ReturnType<RunArtifactsReader['listRunArtifacts']>,
    getRunArtifact: (key) =>
      this.call({ kind: 'getRunArtifact', key }) as ReturnType<RunArtifactsReader['getRunArtifact']>,
  };

  readonly executions: RunExecutionReader = {
    getRunExecution: (key) =>
      this.call({ kind: 'getRunExecution', key }) as ReturnType<RunExecutionReader['getRunExecution']>,
  };

  readonly results: RunResultReader = {
    getRunResult: (key) => this.call({ kind: 'getRunResult', key }) as ReturnType<RunResultReader['getRunResult']>,
  };

  readonly outputs: OutputArtifactStore = {
    claimArtifact: (request) =>
      this.call({ kind: 'outputClaimArtifact', request }) as ReturnType<OutputArtifactStore['claimArtifact']>,
    recordProgress: (request) =>
      this.call({ kind: 'outputRecordProgress', request }) as ReturnType<OutputArtifactStore['recordProgress']>,
    beginPublication: (request) =>
      this.call({ kind: 'outputBeginPublication', request }) as ReturnType<OutputArtifactStore['beginPublication']>,
    recordPublication: (request) =>
      this.call({ kind: 'outputRecordPublication', request }) as ReturnType<OutputArtifactStore['recordPublication']>,
    scan: (query) => this.call({ kind: 'outputScan', query }) as ReturnType<OutputArtifactStore['scan']>,
    load: (binding) => this.call({ kind: 'outputLoad', binding }) as ReturnType<OutputArtifactStore['load']>,
    readSource: (binding) =>
      this.call({ kind: 'outputReadSource', binding }) as ReturnType<OutputArtifactStore['readSource']>,
    adopt: (request) => this.call({ kind: 'outputAdopt', request }) as ReturnType<OutputArtifactStore['adopt']>,
  };

  readonly events: EventCustodyStore = {
    scan: (query) => this.call({ kind: 'eventScan', query }) as ReturnType<EventCustodyStore['scan']>,
    load: (binding) => this.call({ kind: 'eventLoad', binding }) as ReturnType<EventCustodyStore['load']>,
    ingest: (request) => this.call({ kind: 'eventIngest', request }) as ReturnType<EventCustodyStore['ingest']>,
    confirmAck: (request) =>
      this.call({ kind: 'eventConfirmAck', request }) as ReturnType<EventCustodyStore['confirmAck']>,
    recordProblem: (request) =>
      this.call({ kind: 'eventProblem', request }) as ReturnType<EventCustodyStore['recordProblem']>,
  };

  readonly organizationOverview: OrganizationOverviewReader = {
    read: async (input) => {
      const query = checkedOrganizationOverviewQuery(input);
      return checkedOrganizationOverview(await this.call({ kind: 'getOrganizationOverview', query }), query);
    },
  };

  readonly overview: OverviewReader = {
    read: async (input) => {
      const query = checkedOverviewQuery(input);
      const value = await this.call({ kind: 'getWorkspaceOverview', query });
      return checkedOverview(value, query);
    },
  };

  readonly runs: RunStore & RunReader & RunCancellationStore = {
    execute: (command) => this.call({ kind: 'run', command }) as ReturnType<RunStore['execute']>,
    getRun: (key) => this.call({ kind: 'getRun', key }) as ReturnType<RunReader['getRun']>,
    listRuns: (query) => this.call({ kind: 'listRuns', query }) as ReturnType<RunReader['listRuns']>,
    cancel: (command) => this.call({ kind: 'cancelRun', command }) as ReturnType<RunCancellationStore['cancel']>,
  };

  readonly installationStatus: InstallationStatusReader = {
    poolUsage: () => this.call({ kind: 'getPoolUsage' }) as ReturnType<InstallationStatusReader['poolUsage']>,
    runQueue: (key) => this.call({ kind: 'getRunQueue', key }) as ReturnType<InstallationStatusReader['runQueue']>,
  };

  readonly dispatch: DispatchStore = {
    scan: (query) => this.call({ kind: 'dispatchScan', query }) as ReturnType<DispatchStore['scan']>,
    readOffer: (key) => this.call({ kind: 'dispatchReadOffer', key }) as ReturnType<DispatchStore['readOffer']>,
    claim: (key) => this.call({ kind: 'dispatchClaim', key }) as ReturnType<DispatchStore['claim']>,
    observe: (request) => this.call({ kind: 'dispatchObserve', request }) as ReturnType<DispatchStore['observe']>,
  };

  readonly inputs: InputStore = {
    control: (command) => this.call({ kind: 'input', command }) as ReturnType<InputStore['control']>,
    advance: (command) => this.call({ kind: 'advanceInput', command }) as ReturnType<InputStore['advance']>,
    get: (key) => this.call({ kind: 'getInput', key }) as ReturnType<InputStore['get']>,
    list: (query) => this.call({ kind: 'listInputs', query }) as ReturnType<InputStore['list']>,
    recovery: (query) => this.call({ kind: 'recoverInputs', query }) as ReturnType<InputStore['recovery']>,
    storage: () => this.call({ kind: 'inputStorage' }) as ReturnType<InputStore['storage']>,
  };

  readonly suites: SuiteStore & SuiteReader = {
    execute: (command) => this.call({ kind: 'suite', command }) as ReturnType<SuiteStore['execute']>,
    getSuite: (key) => this.call({ kind: 'getSuite', key }) as ReturnType<SuiteReader['getSuite']>,
    getRevision: (key) => this.call({ kind: 'getRevision', key }) as ReturnType<SuiteReader['getRevision']>,
    listSuites: (query) => this.call({ kind: 'listSuites', query }) as ReturnType<SuiteReader['listSuites']>,
    listRevisions: (query) => this.call({ kind: 'listRevisions', query }) as ReturnType<SuiteReader['listRevisions']>,
  };

  readonly namespaceDeletions: NamespaceDeletionStore = {
    delete: (command) =>
      this.call({ kind: 'deleteNamespace', command }) as ReturnType<NamespaceDeletionStore['delete']>,
  };

  readonly namespaces: NamespaceStore = {
    execute: (command) => this.call({ kind: 'namespace', command }) as ReturnType<NamespaceStore['execute']>,
  };

  readonly settings: SettingsStore = {
    execute: (command) => this.call({ kind: 'settings', command }) as ReturnType<SettingsStore['execute']>,
  };

  private constructor(options: MetadataOptions, bootstrap: Bootstrap) {
    super(options, bootstrap);
  }

  static async open(options: MetadataOptions): Promise<Metadata> {
    const bootstrap = validateOptions(options);
    let metadata: Metadata;
    try {
      metadata = new Metadata(options, bootstrap);
    } catch {
      throw new StorageError('unavailable');
    }
    const timer = setTimeout(() => metadata.fail('unavailable', 'startup_timeout'), 5000);
    try {
      await metadata.ready;
      return metadata;
    } catch (error) {
      await metadata.terminate();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  get(key: EntityKey): Promise<NamespaceEntity> {
    return this.call({ kind: 'get', key }) as Promise<NamespaceEntity>;
  }

  list(query: ListQuery): Promise<EntityPage> {
    return this.call({ kind: 'list', query }) as Promise<EntityPage>;
  }

  getSettings(scope: SettingsScope): Promise<SettingsView> {
    return this.call({ kind: 'getSettings', scope }) as Promise<SettingsView>;
  }

  /** Internal identity seam: does not resolve defaults or inspect runtime capacity. */
  getSettingsIdentity(scope: SettingsScope): Promise<SettingsIdentity> {
    return this.call({ kind: 'getSettingsIdentity', scope }) as Promise<SettingsIdentity>;
  }

  updateRuntime(runtime: RuntimeObservation | null): Promise<null> {
    return this.call({ kind: 'runtime', runtime }) as Promise<null>;
  }
}

export const openMetadata = Metadata.open;
