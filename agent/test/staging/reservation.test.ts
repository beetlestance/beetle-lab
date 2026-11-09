import { createHash } from 'node:crypto';
import { deriveInstalledIdentity } from '@beetle/contracts';
import { expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { Reservation } from '../../src/admission/index.js';
import { fixture } from './fixtures.js';
const f = fixture();
it.each(['charge', 'policy', 'engine', 'budget', 'config', 'generation', 'scope', 'create', 'start', 'runtime', 'closed', 'aborted', 'released', 'date'])('rejects corrupted/mismatched %s authority before task I/O', async kind => {
  const e = await f.environment(); await f.close(e.owner);
  const db = new DatabaseSync(e.journalPath);
  try {
    const row = db.prepare('SELECT reservation_json FROM reservations').get()!;
    const reservation = JSON.parse(String(row.reservation_json)) as Reservation;
    const mutations: Record<string, () => void> = {
      charge: () => { reservation.resources.stagingBytes--; },
      policy: () => { reservation.staging = { ...reservation.staging, metadataBytes: 1 }; },
      engine: () => { reservation.engine.imageDigest = `sha256:${'c'.repeat(64)}`; },
      budget: () => { reservation.budget.timeoutMs++; },
      config: () => { reservation.validation.configDigest = 'd'.repeat(64); },
      generation: () => { reservation.generation++; },
      scope: () => { reservation.workspaceId = reservation.attemptId; },
      create: () => { reservation.createToken = 'c'.repeat(64); },
      start: () => { reservation.startToken = 'c'.repeat(64); },
      runtime: () => { reservation.runtimeId = 'c'.repeat(64); },
      closed: () => { reservation.launchClosed = true; },
      aborted: () => { reservation.aborted = true; },
      released: () => { reservation.status = 'released'; },
      date: () => { reservation.admittedAt = Number.MAX_SAFE_INTEGER; },
    };
    mutations[kind]!();
    db.prepare('UPDATE reservations SET reservation_json=?').run(JSON.stringify(reservation));
  } finally { db.close(); }
  const owner = await f.open(e.journalPath);
  const task = e.prepare(e.create({ journal: owner })); expect((await task.result).ok).toBe(false); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual([]);
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
