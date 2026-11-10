import { OutputAbsences, absenceOperation } from './output-absence/index.js';
import { OutputFinalizations, finalizationOperation } from './output-finalization/index.js';
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
import { transaction } from './schema.js';
import { boundedCopy, lower, scopeKey, suiteOperation, operationMessageLimit } from './input.js';
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
  private readonly absences: OutputAbsences;
  private readonly finalizations: OutputFinalizations;
  private readonly results: RunResults;
  private readonly outputs: OutputCustody;
  private readonly events: EventCustody;
  private readonly dispatchClaims: DispatchClaims;
  private readonly dispatchObservations: DispatchObservations;
  private readonly runs: Runs;
  private readonly runCancellations: RunCancellations;
  private readonly runReads: RunReads;
  private readonly inputs: Inputs;
  private readonly inputReads: InputReads;
  private readonly suites: Suites;
  private readonly suiteReads: SuiteReads;
  private readonly entities: Entities;
  private readonly namespaces: Namespaces;
  private readonly settings: Settings;
  private readonly reads: Reads;
  constructor(private readonly db: DatabaseSync, bootstrap: Bootstrap) {
    this.absences = new OutputAbsences(db);
    this.finalizations = new OutputFinalizations(db);
    this.outputs = new OutputCustody(db, bootstrap.installation.id);
    this.events = new EventCustody(db, bootstrap.installation.id);
    this.entities = new Entities(db);
    this.suites = new Suites(db, this.entities);
    this.suiteReads = new SuiteReads(db, this.suites);
    this.settings = transaction(db, () => new Settings(db, bootstrap));
    this.runs = new Runs(db, this.suites, this.settings, bootstrap.runs ?? { profiles: [], pendingLimit: 256 });
    this.runReads = new RunReads(db, this.suites);
    this.results = new RunResults(db, this.runReads);
    this.runCancellations = new RunCancellations(db, this.runReads);
    this.dispatchClaims = new DispatchClaims(db, this.settings, bootstrap.runs ?? { profiles: [], pendingLimit: 256 });
    this.dispatchObservations = new DispatchObservations(db, this.runReads);
    this.inputs = new Inputs(db, this.entities, this.settings);
    this.inputReads = new InputReads(db, this.entities);
    this.namespaces = new Namespaces(db, this.entities, this.settings);
    this.reads = new Reads(db, this.entities);
  }
  private mutation(operation: Extract<Operation, { kind: 'namespace' | 'settings' | 'suite' | 'input' | 'run' | 'cancelRun' }>): Value {
    const command = operation.command;
    return transaction(this.db, () => {
      const scope = scopeKey(command.request.scope);
      const requestId = lower(command.request.requestId);
      const receipt = this.db.prepare(`SELECT digest,
        CASE WHEN length(CAST(result_json AS BLOB))<=? THEN result_json ELSE NULL END result_json
        FROM receipts WHERE scope_key=? AND request_id=?`)
        .get(operationMessageLimit(operation), scope, requestId);
      if (receipt) {
        if (receipt.digest !== command.intentDigest) throw new StorageError('conflict');
        if (typeof receipt.result_json !== 'string') throw new StorageError('unavailable');
        const value = JSON.parse(receipt.result_json) as Value;
        return operation.kind === 'cancelRun' ? captureCancelRunReply(value, operation.command) : value;
      }
      const value = this.change(operation);
      const copy = boundedCopy(value, operationMessageLimit(operation));
      this.db.prepare('INSERT INTO receipts(scope_key,request_id,digest,result_json) VALUES (?,?,?,?)')
        .run(scope, requestId, command.intentDigest, JSON.stringify(copy));
      return copy;
    });
  }
  private change(operation: Extract<Operation, { kind: 'namespace' | 'settings' | 'suite' | 'input' | 'run' | 'cancelRun' }>): Value {
    switch (operation.kind) {
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
  private settingsOperation(operation: Operation): Value {
    switch (operation.kind) {
      case 'getSettings': return this.settings.get(operation.scope);
      case 'getSettingsIdentity': return this.settings.identity(operation.scope);
      case 'runtime': return this.settings.updateRuntime(operation.runtime);
      default: throw new StorageError('invalid_input');
    }
  }
  execute(operation: Operation): Value {
    if (absenceOperation(operation)) return this.absences.execute(operation);
    if (finalizationOperation(operation)) return this.finalizations.execute(operation);
    if (operation.kind === 'getRunResult') return this.results.get(operation.key);
    if (outputOperation(operation)) return this.outputs.execute(operation);
    if (eventOperation(operation)) return this.events.execute(operation);
    return this.executeLegacy(operation);
  }
  private executeLegacy(operation: Operation): Value {
    if (['run', 'cancelRun', 'getRun', 'listRuns', 'dispatchScan', 'dispatchReadOffer', 'dispatchClaim', 'dispatchObserve']
      .includes(operation.kind)) return this.runOperation(operation);
    if (suiteOperation(operation)) return this.suiteOperation(operation);
    if (['getSettings', 'getSettingsIdentity', 'runtime'].includes(operation.kind)) return this.settingsOperation(operation);
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
