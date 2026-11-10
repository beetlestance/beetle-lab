import { expect, it } from 'vitest';
import { json, rows, sourceFixture, used } from './fixtures.js';
const f = sourceFixture();
it.each([0, 1])('charges exact intent quota (%s byte short) without partial insertion', async short => {
  const e = await f.native(); const charge = Buffer.byteLength(json(e.intent)) + 256; const beforeUsed = used(e.db);
  e.db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(beforeUsed + charge - short);
  const before = rows(e.db);
  const issue = () => e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  if (short) { expect(issue).toThrow(expect.objectContaining({ code: 'quota_exceeded' })); expect(rows(e.db)).toEqual(before); }
  else { issue(); expect(used(e.db)).toBe(beforeUsed + charge); }
});
it.each([0, 1])('charges all six source quota components (%s byte short), preserving exact replay under lower quota', async short => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  const charge = Buffer.byteLength(json(e.source)) + 256; const beforeUsed = used(e.db);
  e.db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(beforeUsed + charge - short);
  const before = rows(e.db); const issue = () => e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  if (short) { expect(issue).toThrow(expect.objectContaining({ code: 'quota_exceeded' })); expect(rows(e.db)).toEqual(before); }
  else { const receipt = issue(); expect(used(e.db)).toBe(beforeUsed + charge); expect(issue()).toEqual(receipt); }
});
it('keeps source/intent charges across real ACK/prune, close/reopen and release', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); const receipt = await e.journal.commitOutputSource(e.collected);
  const snapshot = await e.journal.get(e.key);
  await e.journal.acknowledge({ protocolVersion: '1.0', ...e.key, throughSeq: snapshot.lastSeq });
  await e.journal.prune(e.key); await e.journal.releaseOutputSource(receipt); await f.close(e.journal);
  const db = (await import('node:sqlite')).DatabaseSync; const native = new db(e.path, { readOnly: true });
  try {
    expect(native.prepare('SELECT collection_bytes,source_bytes,spool_bytes,hold_bytes FROM accepted_attempts').get()).toEqual({
      collection_bytes: Buffer.byteLength(json(e.intent)) + 256, source_bytes: Buffer.byteLength(json(e.source)) + 256, spool_bytes: 0, hold_bytes: 512 });
    expect(native.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained');
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { native.close(); }
});
it.each(['collection_bytes=1', 'source_bytes=1', 'collection_bytes=collection_bytes-1', 'source_bytes=source_bytes-1', 'quota_bytes=1024'])('rejects forged parent %s atomically', async change => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) }); e.op({ kind: 'outputSourceCommit', json: json(e.source) });
  const before = rows(e.db); expect(() => e.db.exec(`UPDATE accepted_attempts SET ${change}`)).toThrow(); expect(rows(e.db)).toEqual(before);
});
