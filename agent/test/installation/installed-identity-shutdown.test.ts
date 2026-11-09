import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { createConfigSchema } from '@beetle/contracts/engine-config';
import { expect, it, vi } from 'vitest';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { JournalError } from '../../src/journal/index.js';
import type { AdmissionCommand, AdmissionValue } from '../../src/admission/index.js';
import { configuration } from '../admission/fixtures.js';
import { deferred, fixture, operation, scope } from './fixtures.js';

const f = fixture();
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function persisted(path: string) {
  const db = new DatabaseSync(path);
  try {
    return ['accepted_attempts', 'admission_queue', 'reservations', 'event_spool'].map(table =>
      db.prepare(`SELECT * FROM ${table}`).all());
  } finally { db.close(); }
}
async function inherited(binding: 'unbound' | 'changed') {
  const e = await f.setup();
  const manifest = { ...e.engine.manifest, defaultBudget: { ...e.offer.budget } };
  const configSchema = createConfigSchema({ schemas: [{ $id: manifest.schemas.config, type: 'object' }],
    schemaId: manifest.schemas.config, digest: value => createHash('sha256').update(value).digest('hex') });
  const registration = { ...e.engine, manifest, configSchema,
    validation: { ...e.engine.validation, schemaDigest: configSchema.schemaDigest } };
  const initial = createEngineCatalog([registration]);
  const offer = { ...e.offer, installedIdentity: initial.engines[0]!.installedIdentity };
  await e.owner.admission({ kind: 'configure', configuration: { ...configuration(), maxTimeoutMs: 10_000,
    profiles: initial.engines.map(engine => structuredClone(engine.approved)) } });
  const accepting = e.create({ catalog: initial }); await accepting.enqueue(offer); await accepting.close();
  await f.admit(e.owner, offer, e.time.wall()); await f.close(e.owner);
  if (binding === 'unbound') {
    const db = new DatabaseSync(e.journalPath);
    try {
      const row = db.prepare('SELECT offer_json FROM accepted_attempts').get()!;
      const old = JSON.parse(String(row.offer_json)) as Record<string, unknown>; delete old.installedIdentity;
      db.prepare('UPDATE accepted_attempts SET offer_json=?').run(JSON.stringify(old));
    } finally { db.close(); }
  }
  const catalog = binding === 'unbound' ? initial : createEngineCatalog([{ ...registration,
    profile: { ...registration.profile, tmpfsBytes: registration.profile.tmpfsBytes + 1 } }]);
  const before = persisted(e.journalPath); const journal = await f.open(e.journalPath);
  const stagerFor = vi.fn((): never => { throw new Error('unexpected_stager'); });
  const manager = e.create({ journal, catalog, stagerFor });
  const admission = vi.spyOn(journal, 'admission');
  return { ...e, offer, before, journal, manager, admission, stagerFor };
}
it.each(['unbound', 'changed'] as const)('preserves inherited %s charge when close overtakes the original Offer read', async binding => {
  const e = await inherited(binding); const entered = deferred<void>(); const release = deferred<void>();
  const original = e.journal.readOffer.bind(e.journal);
  const read = vi.spyOn(e.journal, 'readOffer').mockImplementationOnce(async key => {
    const value = await original(key); entered.resolve(); await release.promise; return value;
  });
  let driveDone = false; let closeDone = false;
  const driving = e.manager.drive(scope(e.offer), operation());
  void driving.then(() => { driveDone = true; }, () => { driveDone = true; });
  await entered.promise;
  const closing = e.manager.close();
  void closing.then(() => { closeDone = true; }, () => { closeDone = true; });
  try {
    await turn(); expect(driveDone).toBe(false); expect(closeDone).toBe(false);
    expect(e.manager.close()).toBe(closing); expect(read).toHaveBeenCalledOnce();
    expect(e.admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(0);
  } finally { release.resolve(); }
  await expect(driving).rejects.toMatchObject({ reason: 'closed' }); await closing;
  expect(e.admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(0);
  expect(e.stagerFor).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(await readdir(e.rootPath)).toEqual([]);
  await f.close(e.journal); expect(persisted(e.journalPath)).toEqual(e.before);
});
it.each(['unbound', 'changed'] as const)('preserves inherited %s charge after actual queue_full read deferral and close', async binding => {
  const e = await inherited(binding);
  const read = vi.spyOn(e.journal, 'readOffer').mockRejectedValueOnce(new JournalError('queue_full'));
  expect(await e.manager.drive(scope(e.offer), operation())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
  expect(read).toHaveBeenCalledOnce();
  expect((await read.mock.results[0]!.value.catch((error: unknown) => error))).toMatchObject({ code: 'queue_full' });
  await e.manager.close();
  expect(e.admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(0);
  expect(e.stagerFor).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(await readdir(e.rootPath)).toEqual([]);
  await f.close(e.journal); expect(persisted(e.journalPath)).toEqual(e.before);
});
it('cleans a fresh committed admission once after shutdown drains its delayed original reply', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>();
  const original = e.owner.admission.bind(e.owner);
  const admission = vi.spyOn(e.owner, 'admission').mockImplementation(async (command: AdmissionCommand): Promise<AdmissionValue> => {
    const value = await original(command);
    if (command.kind === 'admit') { entered.resolve(); await release.promise; }
    return value;
  });
  const stagerFor = vi.fn((): never => { throw new Error('unexpected_stager'); });
  const manager = e.create({ stagerFor }); await e.accepted(manager);
  let driveDone = false; let closeDone = false;
  const driving = manager.drive(scope(e.offer), operation());
  void driving.then(() => { driveDone = true; }, () => { driveDone = true; }); await entered.promise;
  const before = await original({ kind: 'reservation', key: scope(e.offer) });
  expect(before).toMatchObject({ status: 'charged', aborted: false, createToken: null });
  const closing = manager.close();
  void closing.then(() => { closeDone = true; }, () => { closeDone = true; });
  try {
    await turn(); expect(driveDone).toBe(false); expect(closeDone).toBe(false);
    expect(manager.close()).toBe(closing);
    expect(await original({ kind: 'reservation', key: scope(e.offer) })).toEqual(before);
    expect(admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(0);
    expect(admission.mock.calls.filter(([command]) => command.kind === 'admit')).toHaveLength(1);
  } finally { release.resolve(); }
  expect(await driving).toEqual({ kind: 'released', collection: 'failed' }); await closing;
  expect(admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(1);
  expect(await original({ kind: 'reservation', key: scope(e.offer) })).toMatchObject({ status: 'released', aborted: true });
  expect(stagerFor).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});
it('preserves a committed admission with an unknown original reply instead of assuming fresh ownership', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>();
  const original = e.owner.admission.bind(e.owner);
  const admission = vi.spyOn(e.owner, 'admission').mockImplementation(async (command: AdmissionCommand): Promise<AdmissionValue> => {
    const value = await original(command);
    if (command.kind === 'admit') { entered.resolve(); await release.promise; throw new JournalError('unavailable'); }
    return value;
  });
  const stagerFor = vi.fn((): never => { throw new Error('unexpected_stager'); });
  const manager = e.create({ stagerFor }); await e.accepted(manager);
  const driving = manager.drive(scope(e.offer), operation());
  const failed = expect(driving).rejects.toMatchObject({ code: 'unavailable' }); await entered.promise;
  const before = await original({ kind: 'reservation', key: scope(e.offer) });
  const snapshot = await e.owner.get(scope(e.offer));
  let closeDone = false; const closing = manager.close();
  void closing.then(() => { closeDone = true; }, () => { closeDone = true; });
  try { await turn(); expect(closeDone).toBe(false); }
  finally { release.resolve(); }
  await failed; await closing;
  expect(await original({ kind: 'reservation', key: scope(e.offer) })).toEqual(before);
  expect(await e.owner.get(scope(e.offer))).toEqual(snapshot);
  expect(admission.mock.calls.filter(([command]) => command.kind === 'admit')).toHaveLength(1);
  expect(admission.mock.calls.filter(([command]) => command.kind === 'abortUnstarted')).toHaveLength(0);
  expect(stagerFor).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});
