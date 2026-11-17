import { expect, it } from 'vitest';
import { restoredBackup } from '../../src/bootstrap/historical.js';
import { createLocalSession } from '../../src/adapters/inbound/http/session/index.js';
const backupId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const origin = 'http://127.0.0.1:43131';

it('normalises the sealed header time to canonical UTC and keeps the archive identity', () => {
  expect(restoredBackup({ backupId, createdAt: '2026-11-12T03:00:00+01:00' })).toEqual({
    backupId: backupId.toLowerCase(),
    createdAt: '2026-11-12T02:00:00.000Z',
  });
});
it.each([
  { backupId, createdAt: 'not a time' },
  { backupId, createdAt: '2026-11-12T02:00:00Z'.padEnd(65, ' ') },
  { backupId: 'not-a-uuid', createdAt: '2026-11-12T02:00:00Z' },
])('refuses an unusable backup identity rather than inventing a date (%o)', (value) => {
  expect(() => restoredBackup(value)).toThrow('Invalid historical backup');
});
it('refuses a backup date on a serving (writable) session', () => {
  const backup = restoredBackup({ backupId, createdAt: '2026-11-12T02:00:00Z' });
  expect(() => createLocalSession({ externalOrigin: origin, restoredBackup: backup })).toThrow('Historical backup only');
  const session = createLocalSession({ externalOrigin: origin, readOnly: true, cookieName: 'beetle_history_x', restoredBackup: backup });
  session.close();
});
