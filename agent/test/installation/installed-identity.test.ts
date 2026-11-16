import {rawJournal} from '../journal/raw-connection.js';
import { createConfigSchema } from '@beetle/contracts/engine-config';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { configDigest } from '../../src/journal/index.js';
import { readdir } from 'node:fs/promises';
import { createEngineCatalog } from '../../src/catalog/index.js';
import type { Catalog } from '../../src/catalog/index.js';
import { configuration } from '../admission/fixtures.js';
import { fixture, operation, scope } from './fixtures.js';

const f = fixture();
async function installed() {
  const e = await f.setup();
  const manifest = { ...e.engine.manifest, defaultBudget: { ...e.offer.budget } };
  const configSchema = createConfigSchema({ schemas: [{ $id: manifest.schemas.config, type: 'object' }],
    schemaId: manifest.schemas.config, digest: value => createHash('sha256').update(value).digest('hex') });
  const registration = { ...e.engine, manifest, configSchema,
    validation: { ...e.engine.validation, schemaDigest: configSchema.schemaDigest } };
  const catalog = createEngineCatalog([registration]);
  const job = { ...e.offer, installedIdentity: catalog.engines[0]!.installedIdentity };
  await e.owner.admission({ kind: 'configure', configuration: { ...configuration(), maxTimeoutMs: 10_000,
    profiles: catalog.engines.map(engine => structuredClone(engine.approved)) } });
  return { ...e, catalog, job, registration };
}
it.each(['manifest', 'profile'] as const)('GET/PUT %s drift rejects before durable/provider/runtime effects; exact accepted replay survives', async kind => {
  const e = await installed(); let current = e.catalog;
  const catalog: Catalog = { engines: current.engines, preflightExport: input=>current.preflightExport(input), preflight: input => current.preflight(input),
    resolve: (offer, validation) => current.resolve(offer, validation) };
  const stagerFor = vi.fn((): never => { throw new Error('unexpected_stager'); });
  const manager = e.create({ catalog, stagerFor });
  const first = await manager.enqueue(e.job); expect(first.accepted).toBe(true);
  const updated = { ...e.registration, manifest: structuredClone(e.registration.manifest),
    profile: structuredClone(e.registration.profile) };
  if (kind === 'manifest') updated.manifest.engineVersion = 'changed';
  else Object.assign(updated.profile, { tmpfsBytes: updated.profile.tmpfsBytes + 1 });
  current = createEngineCatalog([updated]);
  const write = vi.spyOn(e.owner, 'admission');
  const newer = { ...e.job, attemptId: f.job(2).attemptId };
  await expect(manager.enqueue(newer)).rejects.toMatchObject({ reason: 'identity' });
  await expect(e.owner.get(scope(newer))).rejects.toMatchObject({ code: 'not_found' });
  expect(await manager.enqueue(Object.fromEntries(Object.entries(e.job).reverse()))).toEqual(first);
  await expect(manager.enqueue({ ...e.job, config: { ...e.job.config, changed: true } })).rejects.toMatchObject({ code: 'conflict' });
  await expect(manager.enqueue({ ...e.job, installedIdentity: undefined })).rejects.toMatchObject({ reason: 'invalid_offer' });
  expect(write).not.toHaveBeenCalled(); expect(stagerFor).not.toHaveBeenCalled();
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']); write.mockRestore();
});

it('rejects every installed binding field before a new durable admission', async () => {
  const e = await installed(); const manager = e.create({ catalog: e.catalog });
  const write = vi.spyOn(e.owner, 'admission');
  for (const field of ['manifestId', 'profileId', 'catalogVersion', 'manifestDigest', 'profileDigest', 'schemaDigest'] as const) {
    const original = e.job.installedIdentity[field];
    const installedIdentity = { ...e.job.installedIdentity,
      [field]: typeof original === 'number' ? original + 1 : field.endsWith('Digest') ? 'f'.repeat(64) : `${original}-changed` };
    await expect(manager.enqueue({ ...e.job, installedIdentity })).rejects.toMatchObject({ reason: 'identity' });
  }
  expect(write).not.toHaveBeenCalled(); write.mockRestore();
  await expect(e.owner.get(scope(e.job))).rejects.toMatchObject({ code: 'not_found' });
});
it('returns scoped not_found for another owner while preserving the original accepted Offer', async () => {
  const e = await installed(); const manager = e.create({ catalog: e.catalog });
  await manager.enqueue(e.job);
  for (const change of [{ organizationId: f.job(2).organizationId }, { workspaceId: f.job(99).attemptId }]) {
    await expect(manager.enqueue({ ...e.job, ...change })).rejects.toMatchObject({ code: 'not_found' });
  }
  expect(await e.owner.readOffer(scope(e.job))).toEqual(e.job);
});
it('keeps an already owned controller on its original bound plan after catalogue drift', async () => {
  const e = await f.setup(); let drift = false;
  const catalog = { ...e.catalog, resolve(offer: Parameters<Catalog['resolve']>[0], validation: Parameters<Catalog['resolve']>[1]) {
    if (drift) throw new Error('changed_catalogue');
    return e.catalog.resolve(offer, validation);
  } };
  const manager = e.create({ catalog }); await e.accepted(manager);
  await manager.drive(scope(e.offer), operation());
  expect(e.backend.starts).toBe(1); drift = true;
  await e.finish(manager);
  expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
  expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('released');
});
it('quarantines a cached staged plan before a controller takes ownership', async () => {
  const e = await f.setup(); let drift = false;
  const catalog = { ...e.catalog, resolve(offer: Parameters<Catalog['resolve']>[0], validation: Parameters<Catalog['resolve']>[1]) {
    if (drift) throw new Error('changed_catalogue');
    return e.catalog.resolve(offer, validation);
  } };
  const manager = e.create({ catalog, guard: { watch: () => ({
    initial: Promise.reject(new Error('synthetic_initial_failure')),
    status: () => ({ ready: false, closed: false, stopRequested: false, lastKnownAt: 0 }), close: async () => undefined,
  }) } });
  await e.accepted(manager);
  await expect(manager.drive(scope(e.offer), operation())).rejects.toThrow('synthetic_initial_failure');
  const before = await manager.inspect(scope(e.offer)); drift = true;
  expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'rejected', reason: 'installed_identity' });
  expect(await manager.inspect(scope(e.offer))).toEqual(before);
  await manager.close(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect((await e.owner.admission({ kind: 'reservation', key: scope(e.offer) }))).toEqual(before.allocation);
});

function durable(path: string) {
  const db = rawJournal(path);
  try {
    return ['accepted_attempts', 'admission_queue', 'reservations', 'event_spool'].map(table =>
      db.prepare(`SELECT * FROM ${table}`).all());
  } finally { db.close(); }
}
it.each([
  ['queued', 'unbound'], ['charged', 'unbound'], ['claimed', 'unbound'], ['queued', 'changed'], ['charged', 'changed'], ['claimed', 'changed'],
] as const)('restart quarantines %s %s records read-only through drive and shutdown', async (state, binding) => {
  const e = await installed();
  await e.owner.admission({ kind: 'offer', offer: e.job,
    validation: { ...e.registration.validation, configDigest: configDigest(e.job.config) }, now: e.time.wall() });
  if (state !== 'queued') await f.admit(e.owner, e.job, e.time.wall());
  if (state === 'claimed') await e.owner.admission({ kind: 'claimCreate', key: scope(e.job), specDigest: 'f'.repeat(64) });
  await f.close(e.owner);
  if (binding === 'unbound') {
    const db = rawJournal(e.journalPath);
    try {
      const raw = db.prepare('SELECT offer_json FROM accepted_attempts').get()!;
      const offer = JSON.parse(String(raw.offer_json)) as Record<string, unknown>; delete offer.installedIdentity;
      // Deliberately preserve old canonical bytes and candidate/charge snapshots.
      db.prepare('UPDATE accepted_attempts SET offer_json=?').run(JSON.stringify(offer));
    } finally { db.close(); }
  }
  const before = durable(e.journalPath); const journal = await f.open(e.journalPath);
  const next = { ...e.registration, profile: { ...e.registration.profile, tmpfsBytes: e.registration.profile.tmpfsBytes + 1 } };
  const catalog = binding === 'unbound' ? e.catalog : createEngineCatalog([next]);
  const stagerFor = vi.fn((): never => { throw new Error('unexpected_stager'); });
  const manager = e.create({ journal, catalog, stagerFor });
  const snapshot = await journal.get(scope(e.job));
  expect(await manager.drive(scope(e.job), operation())).toEqual({ kind: 'rejected', reason: 'installed_identity' });
  expect((await manager.inspect(scope(e.job))).snapshot).toEqual(snapshot);
  await manager.close(); await f.close(journal);
  expect(durable(e.journalPath)).toEqual(before);
  expect(stagerFor).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
});
