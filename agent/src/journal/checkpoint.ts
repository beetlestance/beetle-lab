import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { copyWrapperBatch, copyWrapperCheckpoint } from '../control-protocol/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../control-protocol/index.js';
import { canonical } from './input.js';
import { eventInput } from './event-input.js';
import { appendAtomic } from './spool.js';
import { Failure, owner, transaction } from './sql.js';
import type { Row } from './sql.js';
import type { GenerationKey } from './protocol.js';

export function readWrapperCheckpoint(db: DatabaseSync, key: GenerationKey): Readonly<WrapperCheckpoint> | null {
  const row = owner(db, key);
  return row.wrapper_checkpoint_json === null ? null : copyWrapperCheckpoint(JSON.parse(row.wrapper_checkpoint_json));
}
function checked(input: WrapperBatch): Readonly<WrapperBatch> {
  try { return copyWrapperBatch(input); } catch { throw new Failure('invalid_input'); }
}
function equal(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
function reconcile(row: Row, request: WrapperBatch, digest: string, next: WrapperCheckpoint): Readonly<WrapperCheckpoint> | null {
  const current = row.wrapper_checkpoint_json === null ? null : copyWrapperCheckpoint(JSON.parse(row.wrapper_checkpoint_json));
  if (row.wrapper_high !== (current?.wrapperSeq ?? 0)) throw new Failure('conflict');
  if (current?.lastBatchDigest === digest && equal(current, next)) return current;
  if (!equal(current, request.expected)) throw new Failure('conflict');
  return null;
}
/** The sole wrapper checkpoint writer. No file IO or caller callbacks inside this transaction. */
export function commitWrapperBatch(db: DatabaseSync, input: WrapperBatch): Readonly<WrapperCheckpoint> {
  const request = checked(input);
  const digest = createHash('sha256').update(canonical(request)).digest('hex');
  const next: WrapperCheckpoint = { ...request.next, lastBatchDigest: digest };
  const json = JSON.stringify(next); const bytes = Buffer.byteLength(json);
  if (bytes > 1024) throw new Failure('invalid_input');
  return transaction(db, () => {
    const row = owner(db, request.key);
    const replay = reconcile(row, request, digest, next); if (replay) return replay;
    if (row.spool_bytes + row.snapshot_bytes + bytes > row.quota_bytes) throw new Failure('quota_exceeded');
    // Reserve the complete replacement before appendAtomic charges events/projections.
    // Its temporary future cursor is visible only inside this all-or-nothing transaction.
    db.prepare('UPDATE accepted_attempts SET wrapper_checkpoint_json=?,checkpoint_bytes=? WHERE id=?').run(json, bytes, row.id);
    for (const event of request.events) appendAtomic(db, eventInput(event, 'wrapper'));
    if (owner(db, request.key).wrapper_high !== next.wrapperSeq) throw new Failure('conflict');
    return Object.freeze(next);
  });
}
