import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { DEFAULT_QUOTA_BYTES } from './event-input.js';
import { offerInput } from './input.js';
import type { AttemptKey, Command, Value } from './protocol.js';
import { acknowledge, prune, readEvents } from './replay.js';
import { append } from './spool.js';
import { columns, Failure, owner, snapshot, transaction } from './sql.js';
import type { Row } from './sql.js';

export class Store {
  private readonly byAttempt: StatementSync;
  private readonly insert: StatementSync;
  private readonly cancel: StatementSync;
  private readonly read: StatementSync;
  private readonly list: StatementSync;
  constructor(private readonly db: DatabaseSync, private readonly quota = DEFAULT_QUOTA_BYTES) {
    this.byAttempt = db.prepare(`SELECT ${columns}, canonical_json FROM accepted_attempts WHERE attempt_id=?`);
    this.insert = db.prepare(`INSERT INTO accepted_attempts
      (attempt_id,organization_id,workspace_id,intent_digest,generation,state,last_seq,offer_json,canonical_json,quota_bytes)
      VALUES (?,?,?,?,1,'offered',0,?,?,?)`);
    this.cancel = db.prepare('UPDATE accepted_attempts SET cancel_requested=1 WHERE id=?');
    this.read = db.prepare(`SELECT CASE WHEN length(CAST(offer_json AS BLOB))<=1048576
      THEN offer_json ELSE NULL END AS offer_json FROM accepted_attempts WHERE id=?`);
    this.list = db.prepare(`SELECT ${columns} FROM accepted_attempts WHERE id>? ORDER BY id LIMIT ?`);
  }
  private offer(command: Extract<Command, { kind: 'offer' }>): AttemptSnapshot {
    const offer = JSON.parse(command.json) as Offer;
    const checked = offerInput(offer);
    if (checked.canonical !== command.canonical) throw new Failure('invalid_input');
    return transaction(this.db, () => {
      const existing = this.byAttempt.get(offer.attemptId) as unknown as (Row & { canonical_json: string }) | undefined;
      if (existing) {
        if (existing.canonical_json !== command.canonical) throw new Failure('conflict');
        return snapshot(existing);
      }
      this.insert.run(offer.attemptId, offer.organizationId, offer.workspaceId, offer.intentDigest,
        command.json, command.canonical, this.quota);
      return snapshot(owner(this.db, offer));
    });
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
    if (['append', 'events', 'ack', 'prune', 'sources'].includes(command.kind)) return this.eventCommand(command);
    switch (command.kind) {
      case 'offer': return this.offer(command);
      case 'get': return snapshot(owner(this.db, command.key));
      case 'cancel': return transaction(this.db, () => {
        this.cancel.run(owner(this.db, command.key).id);
        return snapshot(owner(this.db, command.key));
      });
      case 'read': return this.readOffer(command.key);
      case 'list': return this.listOpen(command.page);
      case 'close': this.db.close(); return null;
      default: throw new Failure('invalid_input');
    }
  }
}
