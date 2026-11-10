import { createHash } from 'node:crypto';
import { deriveInstalledIdentity } from '@beetle/contracts';
import { expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { Reservation } from '../../src/admission/index.js';
import { reserved, scope } from '../admission/fixtures.js';
import { fixture } from './fixtures.js';
const f = fixture();
const guarded = ['charge', 'policy', 'budget', 'generation', 'scope', 'released'] as const;
const writable = ['engine', 'config', 'create', 'start', 'runtime', 'closed', 'aborted', 'date'] as const;
const mutations = {
  charge: (value: Reservation) => { value.resources.stagingBytes--; },
  policy: (value: Reservation) => { value.staging = { ...value.staging, metadataBytes: 1 }; },
  engine: (value: Reservation) => { value.engine.imageDigest = `sha256:${'c'.repeat(64)}`; },
  budget: (value: Reservation) => { value.budget.timeoutMs++; },
  config: (value: Reservation) => { value.validation.configDigest = 'd'.repeat(64); },
  generation: (value: Reservation) => { value.generation++; },
  scope: (value: Reservation) => { value.workspaceId = value.attemptId; },
  create: (value: Reservation) => { value.createToken = 'c'.repeat(64); },
  start: (value: Reservation) => { value.startToken = 'c'.repeat(64); },
  runtime: (value: Reservation) => { value.runtimeId = 'c'.repeat(64); },
  closed: (value: Reservation) => { value.launchClosed = true; },
  aborted: (value: Reservation) => { value.aborted = true; },
  released: (value: Reservation) => { value.status = 'released'; },
  date: (value: Reservation) => { value.admittedAt = Number.MAX_SAFE_INTEGER; },
};
function nativeRows(db: DatabaseSync) {
  return ['reservations', 'accepted_attempts', 'admission_queue', 'event_spool', 'supervision_clock',
    'disk_holds', 'disk_retention_stats', 'sqlite_sequence'].map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
}
it.each(guarded)('rejects native %s mutation with every row and retention counter unchanged', async kind => {
  const e = await f.environment();
  const original = reserved(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) }));
  const malformed = structuredClone(original); mutations[kind](malformed); await f.close(e.owner);
  const db = new DatabaseSync(e.journalPath, { enableForeignKeyConstraints: true });
  try {
    const before = nativeRows(db);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.prepare('UPDATE reservations SET reservation_json=?').run(JSON.stringify(malformed)))
      .toThrow('immutable disk reservation');
    expect(nativeRows(db)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  const owner = await f.open(e.journalPath);
  expect(await owner.admission({ kind: 'reservation', key: scope(e.offer) })).toEqual(original);
  expect(await owner.get(scope(e.offer))).toMatchObject({ admission: { state: 'charged' } });
  expect(await readdir(e.rootPath)).toEqual([]);
});
it.each(guarded)('rejects synthetic malformed %s Journal authority at the independent Stager boundary', async kind => {
  const e = await f.environment();
  const original = reserved(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) }));
  const malformed = structuredClone(original); mutations[kind](malformed);
  const admission = e.owner.admission.bind(e.owner);
  const reply = vi.spyOn(e.owner, 'admission').mockImplementation(input => input.kind === 'reservation'
    ? Promise.resolve(structuredClone(malformed)) : admission(input));
  const providers = { input: vi.fn(e.options.providers.input), secret: vi.fn(e.options.providers.secret) };
  try {
    const task = e.prepare(e.create({ providers }));
    expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
    expect(reply).toHaveBeenCalledWith({ kind: 'reservation', key: scope(e.offer) });
    expect(providers.input).not.toHaveBeenCalled(); expect(providers.secret).not.toHaveBeenCalled();
    expect(await readdir(e.rootPath)).toEqual([]);
  } finally { reply.mockRestore(); }
  expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toEqual(original);
});
it.each(writable)('rejects writable %s corruption read through the reopened Journal before task I/O', async kind => {
  const e = await f.environment(); await f.close(e.owner);
  const db = new DatabaseSync(e.journalPath);
  try {
    const row = db.prepare('SELECT reservation_json FROM reservations').get()!;
    const reservation = JSON.parse(String(row.reservation_json)) as Reservation;
    mutations[kind](reservation);
    db.prepare('UPDATE reservations SET reservation_json=?').run(JSON.stringify(reservation));
  } finally { db.close(); }
  const owner = await f.open(e.journalPath);
  const task = e.prepare(e.create({ journal: owner })); expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual([]);
  if (kind === 'date') expect(await owner.get(scope(e.offer))).toMatchObject({ admission: { state: 'charged' } });
  else await expect(owner.get(scope(e.offer))).rejects.toMatchObject({ code: 'unavailable' });
});
it('rejects an unsupported runtime profile before per-attempt writes', async () => {
  const e = await f.environment(false);
  const profile = { ...e.options.profile, imageDigest: `sha256:${'d'.repeat(64)}` };
  e.offer.installedIdentity = deriveInstalledIdentity({ manifest: e.options.manifest, profile, identity: e.options.validation },
    value => createHash('sha256').update(value).digest('hex'));
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const task = e.prepare(e.create({ profile })); expect(await task.result).toEqual({ ok: false, reason: 'invalid_input' }); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual([]);
});
