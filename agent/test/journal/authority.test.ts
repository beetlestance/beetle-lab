import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { openJournal } from '../../src/journal/index.js';
import { isJournalAuthority, readJournalAuthority } from '../../src/journal/authority.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
const canonical = '12345678-1234-4abc-8def-123456789abc';
function edit(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try { db.exec(sql); } finally { db.close(); }
}

it('returns only a canonical committed identity, stable on reopen and independent per journal', async () => {
  const path = f.path(); let journal = await f.open(path);
  const authority = await journal.journalAuthority();
  expect(isJournalAuthority(authority)).toBe(true);
  expect(await Promise.all(Array.from({ length: 16 }, () => journal.journalAuthority())))
    .toEqual(Array.from({ length: 16 }, () => authority));
  await f.close(journal);
  const db = new DatabaseSync(path);
  try { expect(db.prepare('SELECT * FROM journal_authority').all()).toEqual([{ id: 1, authority }]); }
  finally { db.close(); }
  journal = await f.open(path); expect(await journal.journalAuthority()).toBe(authority);
  const independent = await f.open(); expect(await independent.journalAuthority()).not.toBe(authority);
});

it('uses existing read ownership for queue refusal, close and immediate abort', async () => {
  const journal = await openJournal({ path: f.path(), workerUrl: f.workerUrl(), queueLimit: 1 });
  try {
    const first = journal.journalAuthority();
    await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'queue_full' });
    expect(isJournalAuthority(await first)).toBe(true);
    await journal.close();
    await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'closed' });
  } finally { await journal.abort(); }
  const aborted = await f.open(); const pending = aborted.journalAuthority();
  const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  await aborted.abort(); await rejected;
  await expect(aborted.journalAuthority()).rejects.toMatchObject({ code: 'closed' });
});

it.each([
  'DROP TABLE journal_authority;',
  'DROP TRIGGER journal_authority_no_delete; DELETE FROM journal_authority;',
  'DROP TRIGGER journal_authority_no_update; UPDATE journal_authority SET authority=NULL;',
  "DROP TRIGGER journal_authority_no_update; PRAGMA ignore_check_constraints=ON; UPDATE journal_authority SET authority='INVALID';",
  "DROP TRIGGER journal_authority_no_update; PRAGMA ignore_check_constraints=ON; UPDATE journal_authority SET authority=zeroblob(1048576);",
])('fails typed recovery without repairing damaged authority: %s', async damage => {
  const path = f.path(); const initial = await f.open(path); await f.close(initial); edit(path, damage);
  for (let count = 0; count < 2; count++) {
    const journal = await f.open(path);
    await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'recovery_required' });
    expect(await journal.listOpen({ limit: 1 })).toEqual({ snapshots: [] });
    await f.close(journal);
  }
});

it('bounds raw corrupt-table reads and refuses duplicate or misplaced singleton rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE journal_authority(id,authority)');
    const insert = db.prepare('INSERT INTO journal_authority VALUES (?,?)');
    insert.run(2, canonical); expect(() => readJournalAuthority(db)).toThrow('recovery_required');
    db.exec('DELETE FROM journal_authority'); insert.run(new Uint8Array(1048576), canonical);
    expect(() => readJournalAuthority(db)).toThrow('recovery_required');
    db.exec('DELETE FROM journal_authority'); insert.run(1, canonical); insert.run(1, canonical);
    expect(() => readJournalAuthority(db)).toThrow('recovery_required');
  } finally { db.close(); }
});

it.each([null, '12345678-1234-4ABC-8def-123456789abc', 'x'.repeat(4096), { authority: canonical }])(
  'fences malformed worker authority replies before they escape: %j', async value => {
    const path = f.path() + '.mjs';
    await writeFile(path, `import {parentPort} from 'node:worker_threads';
      parentPort.on('message', ({id}) => parentPort.postMessage({kind:'result',id,ok:true,value:${JSON.stringify(value)}}));
      parentPort.postMessage({kind:'ready'});`);
    const journal = await openJournal({ path: f.path(), workerUrl: pathToFileURL(path) });
    try {
      await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'unavailable' });
      await expect(journal.listOpen({ limit: 1 })).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await journal.abort(); }
  });
