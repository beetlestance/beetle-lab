import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { journalFixture } from './fixtures.js';
import type { SupervisionCommand } from '../../src/journal/index.js';

const f = journalFixture();

it('keeps first system reason and timestamp through racing user cancel and restart', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  const [system, user] = await Promise.all([
    journal.supervision({ key: f.key(), now: 1000, cancel: true, reason: 'output_limit' }),
    journal.supervision({ key: f.key(), now: 1001, cancel: true }),
  ]);
  expect(system).toMatchObject({ cancelRequestedAt: 1000, cancelReason: 'output_limit', immediateStop: true });
  expect(user).toMatchObject({ cancelRequestedAt: 1000, cancelReason: 'output_limit' });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.supervision({ key: f.key(), now: 2000, cancel: true, reason: 'timeout' }))
    .toMatchObject({ cancelRequestedAt: 1000, cancelReason: 'output_limit', clockFenced: false });
});

it('does not relabel a user cancellation when a later system stop races it', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer());
  const [user, system] = await Promise.all([
    journal.supervision({ key: f.key(), now: 1000, cancel: true }),
    journal.supervision({ key: f.key(), now: 1000, cancel: true, reason: 'artifact_incomplete' }),
  ]);
  expect(user).toMatchObject({ cancelReason: 'cancelled', cancelRequestedAt: 1000 });
  expect(system).toMatchObject({ cancelReason: 'cancelled', cancelRequestedAt: 1000, immediateStop: true });
});

it.each([
  { reason: 'output_limit' }, { cancel: true, reason: 'invented' }, { cancel: false, reason: 'cancelled' },
])('rejects invalid private reason command %j without intent', async fields => {
  const journal = await f.open(); await journal.immutableOffer(f.offer());
  await expect(journal.supervision({ key: f.key(), now: 1000, ...fields } as SupervisionCommand))
    .rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.get(f.key())).toMatchObject({ cancelRequested: false });
});

it('migrates a v6 cancellation without inventing its missing historical cause or renewing grace', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  const before = await journal.supervision({ key: f.key(), now: 1000, cancel: true });
  await f.close(journal);
  const db = new DatabaseSync(path);
  try { db.exec('DROP TABLE cancelled_originals; DROP TABLE journal_authority; ALTER TABLE supervision_clock DROP COLUMN cancel_reason; ALTER TABLE supervision_clock DROP COLUMN stop_immediate; PRAGMA user_version=6;'); }
  finally { db.close(); }
  journal = await f.open(path);
  expect(await journal.supervision({ key: f.key(), now: 2000, cancel: true, reason: 'output_limit' }))
    .toMatchObject({ cancelRequested: true, cancelRequestedAt: before.cancelRequestedAt, cancelReason: null, clockFenced: true });
});

it('rolls reason, intent, queue retirement and clock back when clock persistence fails', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer()); await f.close(journal);
  const db = new DatabaseSync(path);
  try { db.exec("CREATE TRIGGER reject_reason BEFORE INSERT ON supervision_clock BEGIN SELECT RAISE(ABORT,'synthetic'); END"); }
  finally { db.close(); }
  journal = await f.open(path);
  await expect(journal.supervision({ key: f.key(), now: 1000, cancel: true, reason: 'output_limit' }))
    .rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort();
  const inspect = new DatabaseSync(path);
  try {
    expect(inspect.prepare('SELECT cancel_requested FROM accepted_attempts').get()?.cancel_requested).toBe(0);
    expect(inspect.prepare('SELECT count(*) AS n FROM supervision_clock').get()?.n).toBe(0);
  } finally { inspect.close(); }
});
