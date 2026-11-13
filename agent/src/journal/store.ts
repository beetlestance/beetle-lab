import { CleanupProgressStore } from './cleanup-progress/store.js';
import { cleanupProgressOperation } from './cleanup-progress-protocol.js';
import { CleanupPlanStore, cleanupPlanOperation } from './cleanup-plans/index.js';
import { RetirementStore, retirementOperation } from './retirement/index.js';
import { NamespaceStore, namespaceOperation } from './staging-namespace/index.js';
import { readExport } from './export-assignment.js';
import { readJournalAuthority } from './authority.js';
import { snapshot } from './snapshot.js';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import { DEFAULT_QUOTA_BYTES } from './event-input.js';
import { offerAtomic } from './offers.js';
import { AdmissionStore } from './admission-store.js';
import type { AttemptKey, Command, Value } from './protocol.js';
import { acknowledge, prune, readEvents } from './replay.js';
import { append } from './spool.js';
import { commitWrapperBatch, readWrapperCheckpoint } from './checkpoint.js';
import { metadataColumns, Failure, owner, transaction } from './sql.js';
import type { Row } from './sql.js';
import { supervise } from './supervision.js';
import { RunnableScan } from './runnable.js';
import { cancelOriginal } from './cancel-original.js';
import { OutputSources, outputSourceOperation } from './output-source.js';
import { executeOutputDelivery, outputDeliveryOperation } from './output-delivery.js';
import { executeOutputAbsence, outputAbsenceOperation } from './output-absence.js';

export class Store {
  private readonly retirements: RetirementStore;
  private readonly cleanupPlans: CleanupPlanStore;
  private readonly cleanupProgress: CleanupProgressStore;
  private readonly namespaces: NamespaceStore;
  private readonly admission: AdmissionStore;
  private readonly read: StatementSync;
  private readonly list: StatementSync;
  private readonly runnable: RunnableScan;
  private readonly outputs: OutputSources;
  constructor(private readonly db: DatabaseSync, private readonly quota = DEFAULT_QUOTA_BYTES) {
    this.cleanupProgress = new CleanupProgressStore(db);
    this.cleanupPlans = new CleanupPlanStore(db);
    this.namespaces = new NamespaceStore(db); this.retirements = new RetirementStore(db);
    this.admission = new AdmissionStore(db, quota);
    this.runnable = new RunnableScan(db);
    this.outputs = new OutputSources(db);
    this.read = db.prepare(`SELECT CASE WHEN length(CAST(offer_json AS BLOB))<=${RUNNER_MAXIMUM_OFFER_BYTES}
      THEN offer_json ELSE NULL END AS offer_json FROM accepted_attempts WHERE id=?`);
    this.list = db.prepare(`SELECT ${metadataColumns}, execution_purpose, NULL AS result_json, NULL AS export_result_json, NULL AS exit_facts_json, NULL AS wrapper_checkpoint_json
      FROM accepted_attempts WHERE id>? ORDER BY id LIMIT ?`);
  }
  private offer(command: Extract<Command, { kind: 'offer' }>): AttemptSnapshot {
    return transaction(this.db, () => offerAtomic(this.db, command, this.quota));
  }
  private readOffer(key: AttemptKey): Offer {
    const row = owner(this.db, key);
    const json = this.read.get(row.id)?.offer_json;
    if (typeof json !== 'string') throw new Failure('unavailable');
    return JSON.parse(json) as Offer;
  }
  private listOpen(page: { limit: number; cursor?: number }): Value {
    const rows = this.list.all(page.cursor ?? 0, page.limit + 1) as unknown as Row[];
    const more = rows.length > page.limit;
    const snapshots = rows.slice(0, page.limit).map(row => snapshot(this.db, row));
    const cursor = rows[page.limit - 1]?.id;
    return more && cursor !== undefined ? { snapshots, cursor } : { snapshots };
  }
  private eventCommand(command: Command): Value {
    switch (command.kind) {
      case 'checkpoint': return readWrapperCheckpoint(this.db, command.key);
      case 'wrapperBatch': return commitWrapperBatch(this.db, command.request);
      case 'append': return append(this.db, command.event);
      case 'events': return readEvents(this.db, command.key, command.after);
      case 'ack': return acknowledge(this.db, command.ack);
      case 'sources': {
        const row = owner(this.db, command.key);
        return { wrapperSeq: row.wrapper_high, supervisorOrdinal: row.supervisor_high };
      }
      case 'prune': return prune(this.db, command.key);
      default: throw new Failure('invalid_input');
    }
  }
  private readCommand(command: Command): Value {
    switch (command.kind) {
      case 'readExportAssignment': return readExport(this.db,command.key);
      case 'authority': return readJournalAuthority(this.db);
      case 'get': return snapshot(this.db, owner(this.db, command.key));
      case 'read': return this.readOffer(command.key);
      case 'list': return this.listOpen(command.page);
      case 'runnable': return this.runnable.read(command.page);
      default: throw new Failure('invalid_input');
    }
  }
  private lifecycleCommand(command: Command): Value {
    switch (command.kind) {
      case 'offer': return this.offer(command);
      case 'cancel': {
        const row = owner(this.db, command.key);
        supervise(this.db, { key: { ...command.key, generation: row.generation }, now: Date.now(), cancel: true });
        return snapshot(this.db, owner(this.db, command.key));
      }
      case 'close': this.db.close(); return null;
      default: throw new Failure('invalid_input');
    }
  }
  private allocationCommand(command: Command): Value {
    if (command.kind === 'supervision') return supervise(this.db, command.request);
    if (command.kind === 'admission') return this.admission.execute(command.request);
    if (command.kind === 'cancelOriginal') return cancelOriginal(this.db, command, this.quota);
    throw new Failure('invalid_input');
  }
  private custodyCommand(command: Command): Value | undefined {
    if (cleanupProgressOperation(command)) return this.cleanupProgress.execute(command);
    if (cleanupPlanOperation(command)) return this.cleanupPlans.execute(command);
    if (retirementOperation(command)) return this.retirements.execute(command);
    if (namespaceOperation(command)) return this.namespaces.execute(command);
    return undefined;
  }
  execute(command: Command): Value {
    const custody = this.custodyCommand(command); if (custody !== undefined) return custody;
    if (outputAbsenceOperation(command)) return executeOutputAbsence(this.db, command);
    if (outputDeliveryOperation(command)) return executeOutputDelivery(this.db, command);
    if (outputSourceOperation(command)) return this.outputs.execute(command);
    if (['supervision', 'admission', 'cancelOriginal'].includes(command.kind)) return this.allocationCommand(command);
    if (['append', 'events', 'ack', 'prune', 'sources', 'checkpoint', 'wrapperBatch'].includes(command.kind)) return this.eventCommand(command);
    if (['authority', 'get', 'read', 'readExportAssignment', 'list', 'runnable'].includes(command.kind)) return this.readCommand(command);
    return this.lifecycleCommand(command);
  }
}
