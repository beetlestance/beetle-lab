import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migration001, transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../../src/adapters/outbound/sqlite/migration005.js';
import { migration006 } from '../../../src/adapters/outbound/sqlite/migration006.js';
import { migration007 } from '../../../src/adapters/outbound/sqlite/migration007.js';
import { reserveHistoricalOutput, acknowledge, enqueue, seedFoundation } from '../execution-foundation-fixtures.js';
import type { EventBinding } from '../../../src/ports/events.js';
it('lazily discovers pre-binding acknowledged originals as unbound without adopting a journal UUID', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    db.exec(migration001); db.exec(migration002); migrate003(db); db.exec(migration004); db.exec(migration005);
    const store = seedFoundation(db); const { key } = enqueue(db, store);
    transaction(db, () => {
      db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        delivery_attempt_id,output_attempt_id) SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        attempt_id,attempt_id FROM execution_intents WHERE attempt_id=?`).run(key.attempt.attemptId);
      reserveHistoricalOutput(db, key, Number.MAX_SAFE_INTEGER);
      db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z'");
      acknowledge(db, key);
    });
    db.exec(migration006); db.exec(migration007);
    expect(store.execute({ kind: 'eventScan', query: { limit: 1 } })).toMatchObject({ items: [{ kind: 'unbound', key }], nextCursor: null });
    const binding: EventBinding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
    expect(() => store.execute({ kind: 'eventLoad', binding })).toThrow('Storage not_found');
    expect(db.prepare('SELECT count(*) n FROM event_cursors').get()?.n).toBe(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
