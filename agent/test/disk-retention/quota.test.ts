import { cleanupControl } from '../../src/cleanup-control/index.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { ControlEvent, Offer } from '@beetle/contracts';
import type { WrapperBatch } from '../../src/control-protocol/index.js';
import { commitWrapperBatch } from '../../src/journal/checkpoint.js';
import { job, native, scope, stats } from './fixtures.js';

function checkpoint(offer: Offer): WrapperBatch {
  const template = JSON.parse(readFileSync('contracts/fixtures/valid/wrapper-progress.json', 'utf8')) as ControlEvent;
  const event: ControlEvent = { ...template, ...scope(offer), seq: 1 };
  const bytes = JSON.stringify(event) + '\n';
  return { key: scope(offer), expected: null, events: [event], next: { version: 1, dev: '1', ino: '2',
    offset: Buffer.byteLength(bytes), wrapperSeq: 1, prefixSha256: createHash('sha256').update(bytes).digest('hex') } };
}
it('admits at the exact event/projection plus hold and reserved cleanup quota and rolls everything back one byte short', () => {
  const base = native(); const a = job(); base.enqueue(a); base.admit(a);
  const event = base.db.prepare('SELECT canonical_json,event_json FROM event_spool').get()!;
  const projection = Number(base.db.prepare('SELECT snapshot_bytes FROM accepted_attempts').get()?.snapshot_bytes);
  const exact = Buffer.byteLength(String(event.canonical_json)) + Buffer.byteLength(String(event.event_json)) + 256 + projection + 512 + cleanupControl.reservedBytes;
  for (const short of [0, 1]) {
    const f = native(exact - short); f.enqueue(a);
    if (short) {
      expect(() => f.admit(a)).toThrow('quota_exceeded');
      expect(f.db.prepare('SELECT hold_bytes,last_seq,spool_rows FROM accepted_attempts').get())
        .toMatchObject({ hold_bytes: 0, last_seq: 0, spool_rows: 0 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM disk_holds').get()?.n).toBe(0);
      expect(stats(f.db)).toMatchObject({ held_count: 0 });
    } else {
      expect(f.admit(a)).toMatchObject({ status: 'charged' });
      expect(f.db.prepare('SELECT quota_bytes,hold_bytes FROM accepted_attempts').get()).toMatchObject({ quota_bytes: exact, hold_bytes: 512 });
    }
  }
});
it('includes the retained metadata charge in checkpoint replacement preflight without partial cursor writes', () => {
  const a = job(); const base = native(); base.enqueue(a); base.admit(a);
  const before = base.db.prepare('SELECT spool_bytes,snapshot_bytes FROM accepted_attempts').get()!;
  const stored = commitWrapperBatch(base.db, checkpoint(a));
  const row = base.db.prepare('SELECT spool_bytes,snapshot_bytes FROM accepted_attempts').get()!;
  const exact = Number(row.spool_bytes) + Number(row.snapshot_bytes) + Buffer.byteLength(JSON.stringify(stored)) + 512 + cleanupControl.reservedBytes;
  const preflightShort = Number(before.spool_bytes) + Number(before.snapshot_bytes) + Buffer.byteLength(JSON.stringify(stored)) + 511 + cleanupControl.reservedBytes;
  for (const quota of [exact, exact - 1, preflightShort]) {
    const f = native(quota); f.enqueue(a); f.admit(a);
    if (quota !== exact) {
      expect(() => commitWrapperBatch(f.db, checkpoint(a))).toThrow('quota_exceeded');
      expect(f.db.prepare('SELECT checkpoint_bytes,wrapper_checkpoint_json,hold_bytes FROM accepted_attempts').get())
        .toMatchObject({ checkpoint_bytes: 0, wrapper_checkpoint_json: null, hold_bytes: 512 });
    } else expect(commitWrapperBatch(f.db, checkpoint(a))).toEqual(stored);
  }
});
