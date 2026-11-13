import { ParentRetentionSnapshots } from './retention-parent/index.js';
import { ManualRunDeletionSnapshots } from './retention-manual/index.js';
import { retentionOperation,captureRetentionOperation } from './retention-wire/index.js';
import type { RetentionOperation,RetentionValue } from '../../../ports/retention.js';
import { WorkspaceRetentionSnapshots } from './retention-selection/index.js';
import { WorkspaceRetentionApplies } from './retention-apply/index.js';
import { RetentionProgress } from './retention-progress/index.js';
import { beginOutputDeletionWithReceipt } from './output-deletion-begin/index.js';
import { readMutationReceipt,writeMutationReceipt } from './mutation-receipts.js';
import { BackendSettlements,settlementOperation,captureSettlementOperation } from './backend-settlement/index.js';
import { assertSettlementConnection } from './backend-settlement-guard/index.js';
import { HistorySummaries, historyOperation } from './run-history/index.js';
import {Overviews} from './overview.js';
import {exportOperation} from './export-wire.js';
import {ExportJobs,ExportClaims,ExportObservations,ExportOutputs} from './export-jobs/index.js';
import type {ExportOperation} from './export-jobs/index.js';
import { LocalSessions, localSessionOperation } from './local-session/index.js';
import { OutputDeletions, deletionOperation, captureDeletionOperation } from './output-deletion/index.js';
import type { OutputDeletionOperation } from '../../../ports/output-deletion-metadata.js';
import { RunExecutions } from './execution-binding/index.js';
import { RunArtifacts, artifactReadOperation } from './run-artifacts/index.js';
import { OutputAbsences, absenceOperation } from './output-absence/index.js';
import { OutputFinalizations, finalizationOperation } from './output-finalization/index.js';
import { RunEvents } from './run-events/index.js';
import { RunResults } from './run-results/index.js';
import { OutputCustody, outputOperation } from './output-custody/index.js';
import { EventCustody, eventOperation } from './event-custody/index.js';
import { Runs } from './runs.js';
import { RunCancellations } from './run-cancellations.js';
import { captureCancelRunReply } from './run-cancellation-reply.js';
import { DispatchClaims } from './dispatch-claims.js';
import { DispatchObservations } from './dispatch-observations.js';
import { dispatchOperation } from './dispatch-wire.js';
import type { DispatchOperation } from './dispatch-wire.js';
import { RunReads } from './run-reads.js';
import { Inputs } from './inputs.js';
import { InputReads } from './input-reads.js';
import { Suites } from './suites.js';
import { SuiteReads } from './suite-reads.js';
import type { DatabaseSync } from 'node:sqlite';
import { SemanticError } from '../../../domain/namespaces/index.js';
import { Entities } from './entities.js';
import { Namespaces } from './namespaces.js';
import { Reads } from './reads.js';
import { Settings } from './settings.js';
import { transaction } from './transaction.js';
import { suiteOperation, operationMessageLimit } from './input.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, ErrorCode, Operation, Value } from './protocol.js';

export function safeCode(error: unknown): ErrorCode {
  if (error instanceof StorageError || error instanceof SemanticError) return error.code;
  if (typeof error === 'object' && error !== null && 'errcode' in error) {
    if (error.errcode === 5 || error.errcode === 6) return 'owned';
    if (typeof error.errcode === 'number' && (error.errcode & 255) === 19) return 'conflict';
  }
  return 'unavailable';
}
export class Store {
  private readonly parentSnapshots:ParentRetentionSnapshots;
  private readonly manualSnapshots:ManualRunDeletionSnapshots;
  private readonly retentionSnapshots:WorkspaceRetentionSnapshots;
  private readonly retentionApplies:WorkspaceRetentionApplies;
  private readonly retentionProgress:RetentionProgress;
  private readonly historySummaries: HistorySummaries;
  private readonly localSessions: LocalSessions;
  private readonly deletions: OutputDeletions;
  private readonly settlements: BackendSettlements;
  private readonly absences: OutputAbsences;
  private readonly finalizations: OutputFinalizations;
  private readonly executions: RunExecutions;
  private readonly results: RunResults;
  private readonly runArtifacts: RunArtifacts;
  private readonly runEvents: RunEvents;
  private readonly outputs: OutputCustody;
  private readonly events: EventCustody;
  private readonly dispatchClaims: DispatchClaims;
  private readonly dispatchObservations: DispatchObservations;
  private readonly exports: ExportJobs;
  private readonly exportClaims: ExportClaims;
  private readonly exportObservations: ExportObservations;
  private readonly exportOutputs: ExportOutputs;
  private readonly runs: Runs;
  private readonly runCancellations: RunCancellations;
  private readonly runReads: RunReads;
  private readonly overviews:Overviews;
  private readonly inputs: Inputs;
  private readonly inputReads: InputReads;
  private readonly suites: Suites;
  private readonly suiteReads: SuiteReads;
  private readonly entities: Entities;
  private readonly namespaces: Namespaces;
  private readonly settings: Settings;
  private readonly reads: Reads;
  constructor(private readonly db: DatabaseSync, bootstrap: Bootstrap) {
    this.historySummaries = new HistorySummaries(this.db);
    this.absences = new OutputAbsences(db);
    this.finalizations = new OutputFinalizations(db);
    this.outputs = new OutputCustody(db, bootstrap.installation.id);
    this.events = new EventCustody(db, bootstrap.installation.id);
    this.entities = new Entities(db);
    this.suites = new Suites(db, this.entities);
    this.suiteReads = new SuiteReads(db, this.suites);
    this.settings = transaction(db, () => new Settings(db, bootstrap));
    this.exports=new ExportJobs(db,this.suites,this.settings,{runs:bootstrap.runs??{profiles:[],pendingLimit:256},exports:bootstrap.exports??{profiles:[],pendingLimit:256}});
    this.exportClaims=new ExportClaims(db,this.exports.reads,this.settings,{runs:bootstrap.runs??{profiles:[],pendingLimit:256},exports:this.exports.configuration});
    this.exportObservations=new ExportObservations(db,this.exports.reads);
    this.exportOutputs=new ExportOutputs(db,this.exports.reads);
    this.runs = new Runs(db, this.suites, this.settings, bootstrap.runs ?? { profiles: [], pendingLimit: 256 });
    this.runReads = new RunReads(db, this.suites);
    this.parentSnapshots=new ParentRetentionSnapshots(db,this.runReads);this.manualSnapshots=new ManualRunDeletionSnapshots(db,this.runReads);this.retentionSnapshots=new WorkspaceRetentionSnapshots(db,this.runReads);this.retentionApplies=new WorkspaceRetentionApplies(db,this.runReads);this.retentionProgress=new RetentionProgress(db,this.runReads);
    this.overviews=new Overviews(db,this.suites);
    this.runArtifacts = new RunArtifacts(db, this.runReads);
    this.executions = new RunExecutions(db, this.runReads);
    this.results = new RunResults(db, this.runReads);
    this.runEvents = new RunEvents(db, this.runReads);
    this.runCancellations = new RunCancellations(db, this.runReads);
    this.dispatchClaims = new DispatchClaims(db, this.settings, bootstrap.runs ?? { profiles: [], pendingLimit: 256 },bootstrap.exports);
    this.dispatchObservations = new DispatchObservations(db, this.runReads);
    this.localSessions = new LocalSessions(db);
    this.settlements = new BackendSettlements(db,this.runReads);
    this.deletions = new OutputDeletions(db, this.runReads,()=>{
      const pool=this.settings.chain({kind:'installation'}).installation.values.pool;
      return {allocationBytes:pool.storageBytes,reserveBytes:pool.freeSpaceReserveBytes};
    });
    this.inputs = new Inputs(db, this.entities, this.settings);
    this.inputReads = new InputReads(db, this.entities);
    this.namespaces = new Namespaces(db, this.entities, this.settings);
    this.reads = new Reads(db, this.entities);
  }
  private mutation(operation: Extract<Operation, { kind: 'namespace' | 'settings' | 'suite' | 'input' | 'run' | 'cancelRun' | 'exportJob' }>): Value {
    const command = operation.command;
    return transaction(this.db, () => {
      const receipt=readMutationReceipt(this.db,command,operationMessageLimit(operation));
      if(receipt.kind==='stored'){
        const value=receipt.value as Value;return operation.kind==='cancelRun'?captureCancelRunReply(value,operation.command):value;
      }
      return writeMutationReceipt(this.db,command,this.change(operation),operationMessageLimit(operation)) as Value;
    });
  }
  private change(operation: Extract<Operation, { kind: 'namespace' | 'settings' | 'suite' | 'input' | 'run' | 'cancelRun' | 'exportJob' }>): Value {
    switch (operation.kind) {
      case 'exportJob': return operation.command.kind==='createExport'?this.exports.create(operation.command):this.exports.cancel(operation.command);
      case 'run': return this.runs.create(operation.command);
      case 'cancelRun': return this.runCancellations.cancel(operation.command);
      case 'input': return this.inputs.control(operation.command);
      case 'suite': return this.suites.change(operation.command);
      case 'namespace': return this.namespaces.change(operation.command);
      case 'settings': return this.settings.change(operation.command);
    }
  }
  private runOperation(operation: Operation): Value {
    if (dispatchOperation(operation)) return this.dispatch(operation);
    switch (operation.kind) {
      case 'run': case 'cancelRun': return this.mutation(operation);
      case 'getRun': return this.runReads.get(operation.key);
      case 'listRuns': return this.runReads.list(operation.query);
      case 'getWorkspaceOverview':return this.overviews.read(operation.query);
      default: throw new StorageError('invalid_input');
    }
  }
  private suiteOperation(operation: Operation): Value {
    switch (operation.kind) {
      case 'suite': return this.mutation(operation);
      case 'getSuite': return this.suites.getSuite(operation.key);
      case 'getRevision': return this.suites.getRevision(operation.key);
      case 'listSuites': case 'listRevisions': return this.suiteReads.list(operation.query) as Value;
      default: throw new StorageError('invalid_input');
    }
  }
  private inputOperation(operation: Operation): Value {
    switch (operation.kind) {
      case 'input': return this.mutation(operation);
      case 'advanceInput': return transaction(this.db, () => this.inputs.advance(operation.command));
      case 'getInput': return this.inputs.get(operation.key);
      case 'listInputs': case 'recoverInputs': return this.inputReads.list(operation.query);
      case 'inputStorage': return this.inputs.storage();
      default: throw new StorageError('invalid_input');
    }
  }
  private installationOperation(operation: Operation): Value {
    if (localSessionOperation(operation)) return this.localSessions.execute(operation);
    switch (operation.kind) {
      case 'getSettings': return this.settings.get(operation.scope);
      case 'getSettingsIdentity': return this.settings.identity(operation.scope);
      case 'runtime': return this.settings.updateRuntime(operation.runtime);
      default: throw new StorageError('invalid_input');
    }
  }
  private deletion(operation: OutputDeletionOperation): Value {
    const captured = captureDeletionOperation(operation);
    return captured.kind === 'beginOutputDeletion' ? transaction(this.db,()=>beginOutputDeletionWithReceipt(this.db,this.deletions,captured.command)) : this.deletions.execute(captured);
  }
  execute(operation: Operation): Value {
    assertSettlementConnection(this.db);
    if(retentionOperation(operation))return this.retention(operation);
    if(settlementOperation(operation))return this.settlement(operation);
    if(exportOperation(operation))return this.exportOperation(operation);
    if (deletionOperation(operation)) return this.deletion(operation);
    if (artifactReadOperation(operation)) return this.runArtifacts.execute(operation);
    if (absenceOperation(operation)) return this.absences.execute(operation);
    if (finalizationOperation(operation)) return this.finalizations.execute(operation);
    if (['getRunEvents','getRunExecution','getRunResult'].includes(operation.kind)) return this.runRead(operation);
    if (historyOperation(operation)) return this.historySummaries.execute(operation);
    return this.executeOutput(operation);
  }
  private retention(input:RetentionOperation):RetentionValue{
    const operation=captureRetentionOperation(input);
    switch(operation.kind){
      case 'previewParentRetention':return this.parentSnapshots.preview(operation.command);
      case 'getWorkspaceRetentionPreview':return this.retentionSnapshots.get(operation.request.key);
      case 'listWorkspaceRetention':return this.retentionProgress.list(operation.request.scope);
      case 'previewRunDeletion':return this.manualSnapshots.preview(operation.command);
      case 'previewWorkspaceRetention':return this.retentionSnapshots.preview(operation.command);
      case 'applyWorkspaceRetention':return this.retentionApplies.apply(operation.command);
      case 'getWorkspaceRetentionStatus':return this.retentionProgress.get(operation.request.key,operation.request.now);
      case 'discardWorkspaceRetention':return this.retentionProgress.discard(operation.request.key,operation.request.now);
    }
  }
  private executeOutput(operation:Operation):Value {
    if(outputOperation(operation))return this.outputs.execute(operation);
    if(eventOperation(operation))return this.events.execute(operation);
    return this.executeLegacy(operation);
  }
  private settlement(operation:Operation):Value {
    const checked=captureSettlementOperation(operation);return checked.kind==='settleBackendOutput'?this.settlements.settle(checked.request):this.settlements.read(checked.key);
  }
  private runRead(operation:Operation):Value {
    switch(operation.kind){
      case 'getRunEvents':return this.runEvents.get(operation.query);
      case 'getRunExecution':return this.executions.get(operation.key);
      case 'getRunResult':return this.results.get(operation.key);
      default:throw new StorageError('invalid_input');
    }
  }
  private exportOperation(operation:ExportOperation):Value {
    switch(operation.kind){
      case 'exportJob':return this.mutation(operation);
      case 'getExport':return this.exports.reads.get(operation.key);
      case 'listExports':return this.exports.reads.list(operation.query);
      case 'getExportProfiles':return {scope:operation.scope,profiles:[...this.exports.profiles(operation.scope)]};
      case 'exportOutput':return this.exportOutputs.execute(operation.operation);
      default:return this.exportExecution(operation);
    }
  }
  private exportExecution(operation:Exclude<ExportOperation,{kind:'exportJob'|'getExport'|'listExports'|'getExportProfiles'|'exportOutput'}>):Value {
    switch(operation.kind){
      case 'scanExportJobs':return this.exportClaims.scan(operation.query);
      case 'getExportOriginal':return this.exportClaims.original(operation.key);
      case 'getExportControl':return this.exportClaims.control(operation.key);
      case 'claimExport':return this.exportClaims.claim(operation.key);
      case 'observeExport':return this.exportObservations.observe(operation.request);
      case 'finalizeExport':return this.exportOutputs.finalize(operation.request);
    }
  }
  private executeLegacy(operation: Operation): Value {
    if (['getWorkspaceOverview','run', 'cancelRun', 'getRun', 'listRuns', 'dispatchScan', 'dispatchReadOffer', 'dispatchClaim', 'dispatchObserve']
      .includes(operation.kind)) return this.runOperation(operation);
    if (suiteOperation(operation)) return this.suiteOperation(operation);
    if (['getSettings', 'getSettingsIdentity', 'runtime', 'loadLocalSession', 'saveLocalSession'].includes(operation.kind)) return this.installationOperation(operation);
    if (['input', 'advanceInput', 'getInput', 'listInputs', 'recoverInputs', 'inputStorage'].includes(operation.kind)) return this.inputOperation(operation);
    switch (operation.kind) {
      case 'namespace': case 'settings': return this.mutation(operation);
      case 'get': return this.entities.get(operation.key);
      case 'list': return this.reads.list(operation.query);
      case 'close': this.db.close(); return null;
      default: throw new StorageError('invalid_input');
    }
  }
  private dispatch(operation: DispatchOperation): Value {
    switch (operation.kind) {
      case 'dispatchScan': return this.dispatchClaims.scan(operation.query);
      case 'dispatchReadOffer': return this.dispatchClaims.readOffer(operation.key);
      case 'dispatchClaim': return this.dispatchClaims.claim(operation.key);
      case 'dispatchObserve': return this.dispatchObservations.observe(operation.request);
    }
  }
}
