import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MAX_RESOURCE_VALUE } from '../../src/admission/index.js';
import { admissionFixture, configuration, now, scope, validation } from './fixtures.js';

const f = admissionFixture();
const rejected = { kind: 'reject', reason: 'below_manifest_minimum' };

it('retains exact original refusal after the actual worker commit reply is lost and the journal reopens', async () => {
  const path = f.path(); let journal = await f.configured(path); const source = f.job(1, 99);
  const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  const id = Number(Reflect.get(journal, 'nextId')) + 1;
  let replyValue: unknown;
  let observed!: () => void; const committed = new Promise<void>(resolve => { observed = resolve; });
  Reflect.set(journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id) {
      replyValue = Reflect.get(reply, 'value'); observed(); return;
    }
    receive.call(journal, reply);
  });
  const lost = f.enqueue(journal, source).then(value => ({ value }), error => ({ error: error as unknown }));
  await committed;
  expect(replyValue).toEqual(rejected);
  await journal.abort(); expect(await lost).toHaveProperty('error');
  const inspect = new DatabaseSync(path);
  try {
    expect(JSON.parse(inspect.prepare('SELECT offer_json FROM accepted_attempts').get()?.offer_json as string)).toEqual(source);
    expect(inspect.prepare('SELECT pending,decision_json FROM admission_queue').get())
      .toMatchObject({ pending: 0, decision_json: JSON.stringify(rejected) });
    expect(inspect.prepare('SELECT absence_pending,last_seq,hold_bytes FROM accepted_attempts').get())
      .toMatchObject({ absence_pending: 1, last_seq: 0, hold_bytes: 0 });
  } finally { inspect.close(); }
  journal = await f.open(path);
  const changed = configuration(); changed.profiles[0]!.minimum.cpuMillis = 1;
  await journal.admission({ kind: 'configure', configuration: changed });
  expect(await f.enqueue(journal, source, now + 100)).toEqual(rejected);
  expect(await journal.readOffer(scope(source))).toEqual(source);
  expect(await journal.get(scope(source))).toMatchObject({ lastSeq: 0, admission: { state: 'rejected', reason: rejected.reason } });
  expect(await journal.admission({ kind: 'reservations', limit: 1 })).toEqual({ reservations: [] });
  for (const offer of [{ ...source, budget: { ...source.budget, cpuMillis: 100 } }, { ...source, intentDigest: 'c'.repeat(64) }]) {
    await expect(f.enqueue(journal, offer)).rejects.toMatchObject({ code: 'conflict' });
  }
  await expect(journal.admission({ kind: 'offer', offer: source, now,
    validation: { ...validation(source), profileId: 'changed' } })).rejects.toMatchObject({ code: 'conflict' });
});

it('rolls back original, closed queue, refusal and debt when a later actual SQL write fails', async () => {
  const path = f.path(); let journal = await f.configured(path); await f.close(journal);
  const inject = new DatabaseSync(path);
  inject.exec("CREATE TRIGGER refusal_failure BEFORE UPDATE OF last_clock ON admission_settings BEGIN SELECT RAISE(ABORT,'synthetic refusal write'); END");
  inject.close(); journal = await f.open(path);
  await expect(f.enqueue(journal, f.job(1, 99))).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort();
  const inspect = new DatabaseSync(path);
  try {
    for (const table of ['accepted_attempts', 'admission_queue', 'reservations', 'event_spool']) {
      expect(inspect.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(inspect.prepare('SELECT last_clock FROM admission_settings').get()?.last_clock).toBe(0);
    inspect.exec('DROP TRIGGER refusal_failure');
  } finally { inspect.close(); }
  journal = await f.open(path); expect(await f.enqueue(journal, f.job(1, 99))).toEqual(rejected);
});

it('rolls back resource and staging candidates the existing snapshot cannot represent', async () => {
  const path = f.path(); let journal = await f.configured(path);
  const resource = f.job(1, MAX_RESOURCE_VALUE + 1);
  const staging = f.job(2, 99); staging.inputs[0]!.bytes = MAX_RESOURCE_VALUE;
  for (const source of [resource, staging]) {
    await expect(f.enqueue(journal, source)).rejects.toMatchObject({ code: 'unavailable' });
    await journal.abort(); journal = await f.open(path);
    await expect(journal.get(scope(source))).rejects.toMatchObject({ code: 'not_found' });
  }
  await f.close(journal);
  const inspect = new DatabaseSync(path);
  try { expect(inspect.prepare('SELECT count(*) AS n FROM admission_queue').get()?.n).toBe(0); }
  finally { inspect.close(); }
});

it('does not consume any of the 1024 pending slots for a final refusal', async () => {
  const journal = await f.configured();
  for (let id = 1; id <= 1024; id++) await f.enqueue(journal, f.job(id, 100));
  const source = f.job(1025, 99);
  expect(await f.enqueue(journal, source)).toEqual(rejected);
  expect(await f.enqueue(journal, f.job(1026, 100))).toEqual({ kind: 'defer', reason: 'pending_full' });
  await journal.durableCancel(scope(f.job(1, 100)));
  expect(await f.enqueue(journal, f.job(1026, 100))).toEqual({ kind: 'defer', reason: 'queued' });
}, 15_000);
