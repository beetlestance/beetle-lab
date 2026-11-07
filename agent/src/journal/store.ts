import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { DEFAULT_QUOTA_BYTES } from './event-input.js';
import { offerAtomic } from './offers.js';
import { AdmissionStore } from './admission-store.js';
import type { AttemptKey, Command, Value } from './protocol.js';
import { acknowledge, prune, readEvents } from './replay.js';
import { append } from './spool.js';
import { columns, Failure, owner, snapshot, transaction } from './sql.js';
import type { Row } from './sql.js';
import { supervise } from './supervision.js';

export class Store {
  private readonly admission: AdmissionStore;
  private readonly read: StatementSync;
  private readonly list: StatementSync;
  constructor(private readonly db: DatabaseSync, private readonly quota = DEFAULT_QUOTA_BYTES) {
    this.admission = new AdmissionStore(db, quota);
    this.read = db.prepare(`SELECT CASE WHEN length(CAST(offer_json AS BLOB))<=1048576
      THEN offer_json ELSE NULL END AS offer_json FROM accepted_attempts WHERE id=?`);
    this.list = db.prepare(`SELECT ${columns} FROM accepted_attempts WHERE id>? ORDER BY id LIMIT ?`);
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
    const snapshots = rows.slice(0, page.limit).map(snapshot);
    const cursor = rows[page.limit - 1]?.id;
    return more && cursor !== undefined ? { snapshots, cursor } : { snapshots };
  }
  private eventCommand(command: Command): Value {
    switch (command.kind) {
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
  execute(command: Command): Value {
    if (command.kind === 'supervision') return supervise(this.db, command.request);
    if (command.kind === 'admission') return this.admission.execute(command.request);
    if (['append', 'events', 'ack', 'prune', 'sources'].includes(command.kind)) return this.eventCommand(command);
    switch (command.kind) {
      case 'offer': return this.offer(command);
      case 'get': return snapshot(owner(this.db, command.key));
      case 'cancel': {
        const row = owner(this.db, command.key);
        supervise(this.db, { key: { ...command.key, generation: row.generation }, now: Date.now(), cancel: true });
        return snapshot(owner(this.db, command.key));
      }
      case 'read': return this.readOffer(command.key);
      case 'list': return this.listOpen(command.page);
      case 'close': this.db.close(); return null;
      default: throw new Failure('invalid_input');
    }
  }
}
