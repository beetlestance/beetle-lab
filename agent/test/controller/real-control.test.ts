import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { deriveInstalledIdentity, sealEngineResult } from '@beetle/contracts';
import { collectOutputs } from '../../src/collection/output/index.js';
import { createAttemptController } from '../../src/controller/index.js';
import { AttemptController } from '../../src/controller/attempt.js';
import { Reader } from '../../src/collection/control/reader.js';
import { nodePorts } from '../../src/collection/control/ports.js';
import { tracking } from '../collection-control/fixture.js';
import { fixture, operation } from '../staging/fixtures.js';
import { controlled, clock, scope } from '../supervisor/fixtures.js';

const f = fixture();
it('wires actual stager, control filesystem, journal checkpoint and supervisor without rescanning history', async () => {
  const e = await f.environment(false);
  e.offer.budget.outputBytes = 4000;
  const profile = outputProfile(e);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const stager = e.create({ profile });
  const prepared = e.prepare(stager); const plan = await prepared.result; await prepared.quiesced;
  if (!plan.ok) throw new Error(plan.reason);
  const time = clock(); time.advance(2); const owner = controlled(e.owner, time);
  const key = scope(e.offer); let collections = 0;
  const result = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal: _seal, ...body } = result; void _seal;
  const sealed = sealEngineResult({ ...body, ...key, artifacts: [] }, '2026-01-01T00:00:00Z',
    text => createHash('sha256').update(text).digest('hex'));
  if (!sealed.ok) throw new Error(sealed.code);
  const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
  await writeFile(join(e.rootPath, plan.value.name, 'output', 'engine-result.json'), JSON.stringify(sealed.value), { mode: 0o600 });
  const path = join(e.rootPath, plan.value.name, 'output', 'control.ndjson');
  await writeFile(path, JSON.stringify(event) + '\n', { mode: 0o600 });
  const controller = createAttemptController({ journal: e.owner, supervisor: owner.manager,
    input: { key, plan: plan.value }, wallNow: time.wall, collectOutputs: options => {
      collections++;
      return collectOutputs(options);
    } });
  try {
    expect(await controller.launch(operation())).toEqual({ kind: 'control', events: 1 });
    const checkpoint = await e.owner.readWrapperCheckpoint(key);
    expect(checkpoint?.offset).toBe(Buffer.byteLength(JSON.stringify(event) + '\n'));
    expect((await e.owner.readEvents(key, 0)).events.filter(e => e.source === 'wrapper')).toHaveLength(1);
    owner.backend.observation = owner.backend.known('exited').value; time.advance(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
    expect(collections).toBe(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'released', collection: 'finished' });
    expect(await e.owner.readWrapperCheckpoint(key)).toEqual(checkpoint);
  } finally { await controller.close(); }
  const source = await e.owner.readOutputSource(key); expect(source).not.toBeNull();
  const root = await lstat(join(e.rootPath, plan.value.name, 'output'), { bigint: true });
  expect(source!.root).toMatchObject({ device: root.dev.toString(), inode: root.ino.toString(),
    modifiedNs: root.mtimeNs.toString(), changedNs: root.ctimeNs.toString() });
  expect(source!.manifest.resultFileBytes).toBe(Buffer.byteLength(JSON.stringify(sealed.value)));
  expect(source!.manifest.controlBytes).toBe(Buffer.byteLength(JSON.stringify(event) + '\n'));
  await f.close(e.owner); expect(nativeFacts(e.journalPath)).toMatchObject({ intents: [{ phase: 'sourced' }], sources: [{ n: 1 }], foreignKeys: [] });
  const reopened = await f.open(e.journalPath); expect(await reopened.readOutputSource(key)).toEqual(source);
});
it('fails an actually empty stopped control file and releases without manufacturing a checkpoint', async () => {
  const e = await f.environment(); const prepared = e.prepare(e.create());
  const plan = await prepared.result; await prepared.quiesced;
  if (!plan.ok) throw new Error(plan.reason);
  const time = clock(); time.advance(2); const owner = controlled(e.owner, time); const key = scope(e.offer);
  await writeFile(join(e.rootPath, plan.value.name, 'output', 'control.ndjson'), '', { mode: 0o600 });
  const controller = createAttemptController({ journal: e.owner, supervisor: owner.manager,
    input: { key, plan: plan.value }, wallNow: time.wall,
    collectOutputs: () => { throw new Error('empty control cannot authorize output collection'); } });
  try {
    expect(await controller.launch(operation())).toMatchObject({ kind: 'runtime' });
    owner.backend.observation = owner.backend.known('exited').value; time.advance(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'awaiting_release', collection: 'failed' });
    expect(await controller.tick(operation())).toEqual({ kind: 'released', collection: 'failed' });
    expect(await e.owner.readWrapperCheckpoint(key)).toBeNull();
  } finally { await controller.close(); }
});
it('defers a valid first stopped frame fragmented across the eight-read budget without closing or failing it', async () => {
  const e = await f.environment(false); e.offer.budget.outputBytes = 4000;
  const profile = outputProfile(e);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const prepared = e.prepare(e.create({ profile }));
  const plan = await prepared.result; await prepared.quiesced;
  if (!plan.ok) throw new Error(plan.reason);
  const time = clock(); time.advance(2); const owner = controlled(e.owner, time); const key = scope(e.offer);
  const event = { ...f.wrapper(), ...key };
  await writeFile(join(e.rootPath, plan.value.name, 'output', 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
  const observed = tracking(1);
  const controller = new AttemptController({ journal: e.owner, supervisor: owner.manager,
    input: { key, plan: plan.value }, wallNow: time.wall,
    createReader: options => new Reader(options, observed.ports),
    collectOutputs: () => { throw new Error('partial frame cannot authorize outputs'); } });
  try {
    expect(await controller.launch(operation())).toMatchObject({ kind: 'runtime' });
    owner.backend.observation = owner.backend.known('exited').value; time.advance(1);
    expect(await controller.tick(operation())).toMatchObject({ kind: 'runtime' });
    expect(observed.reads).toHaveLength(16);
    expect(observed.reads.every(read => read.bytes === 1)).toBe(true);
    expect(observed.closes()).toBe(0);
    expect(await e.owner.readWrapperCheckpoint(key)).toBeNull();
    expect(await e.owner.admission({ kind: 'reservation', key })).toMatchObject({ status: 'charged' });
  } finally { await controller.close(); }
  expect(observed.closes()).toBe(2);
});

function outputProfile(e: Awaited<ReturnType<ReturnType<typeof fixture>['environment']>>) {
  const profile = { ...e.options.profile, maximumBudget: { ...e.options.profile.maximumBudget, outputBytes: 4000 } };
  e.offer.installedIdentity = deriveInstalledIdentity({ manifest: e.options.manifest, profile, identity: e.options.validation },
    text => createHash('sha256').update(text).digest('hex'));
  return profile;
}
function nativeFacts(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return { intents: db.prepare('SELECT phase,charged_bytes FROM output_collection_intents').all(),
      sources: db.prepare('SELECT count(*) AS n FROM output_sources').all(),
      charges: db.prepare('SELECT collection_bytes,source_bytes FROM accepted_attempts').all(),
      holds: db.prepare('SELECT phase FROM disk_holds').all(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  } finally { db.close(); }
}
async function nativeScenario() {
  const e = await f.environment(false); e.offer.budget.outputBytes = 4000; const profile = outputProfile(e);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const prepared = e.prepare(e.create({ profile })); const result = await prepared.result; await prepared.quiesced;
  if (!result.ok) throw new Error(result.reason);
  const plan = result.value; const time = clock(); time.advance(2); const owner = controlled(e.owner, time); const key = scope(e.offer);
  const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal: _seal, ...body } = original; void _seal;
  const sealed = sealEngineResult({ ...body, ...key, artifacts: [] }, '2026-01-01T00:00:00Z',
    text => createHash('sha256').update(text).digest('hex'));
  if (!sealed.ok) throw new Error(sealed.code);
  const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
  const directory = join(e.rootPath, plan.name, 'output');
  await writeFile(join(directory, 'engine-result.json'), JSON.stringify(sealed.value), { mode: 0o600 });
  await writeFile(join(directory, 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
  return { ...e, ...owner, time, key, plan, directory };
}
it.each(['success', 'failure', 'replacement'] as const)('recovers actual native pending files after reopen/expiry: %s', async mode => {
  const e = await nativeScenario();
  const first = createAttemptController({ journal: e.owner, supervisor: e.manager, input: { key: e.key, plan: e.plan }, wallNow: e.time.wall,
    collectOutputs: () => ({ result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }) });
  try {
    await first.launch(operation()); e.backend.observation = e.backend.known('exited').value; e.time.advance(1);
    expect(await first.tick(operation())).toEqual({ kind: 'awaiting_collection', reason: 'busy' });
  } finally { await first.close(); }
  const intent = await e.owner.readOutputCollection(e.key); expect(intent).not.toBeNull(); await f.close(e.owner);
  if (mode === 'failure') await writeFile(join(e.directory, 'engine-result.json'), '{}', { mode: 0o600 });
  if (mode === 'replacement') {
    await rename(e.directory, e.directory + '.original'); await mkdir(e.directory, { mode: 0o700 });
    for (const name of ['control.ndjson', 'engine-result.json']) await rename(join(e.directory + '.original', name), join(e.directory, name));
  }
  const journal = await f.open(e.journalPath); e.time.advance(2000); const owner = controlled(journal, e.time, e.backend);
  const collector = vi.fn(collectOutputs);
  const next = createAttemptController({ journal, supervisor: owner.manager, input: { key: e.key, plan: e.plan },
    wallNow: e.time.wall, collectOutputs: collector });
  try {
    const recover = async () => {
      for (let index = 0; index < 8; index++) {
        const progress = await next.launch(operation());
        if (progress.kind === 'awaiting_release') return progress;
      }
      throw new Error('Native recovery failed to converge within eight bounded steps');
    };
    if (mode === 'success') {
      expect(await recover()).toEqual({ kind: 'awaiting_release', collection: 'finished' });
      const source = await journal.readOutputSource(e.key); expect(source!.root).toEqual(intent!.root);
      expect(source!.checkpoint).toEqual(intent!.checkpoint); expect(source!.release.runtime).toEqual(intent!.runtime);
      expect(source!.release.collection.evidenceId).toBe(intent!.collectionId);
      expect(await next.tick(operation())).toEqual({ kind: 'released', collection: 'finished' });
    } else {
      await expect(recover()).rejects.toMatchObject({ reason: 'journal' });
      expect(await journal.readOutputSource(e.key)).toBeNull(); expect(await journal.readOutputCollection(e.key)).toEqual(intent);
      expect(await journal.admission({ kind: 'reservation', key: e.key })).toMatchObject({ status: 'charged' });
    }
    expect(collector).toHaveBeenCalledTimes(mode === 'replacement' ? 0 : 1);
    expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
  } finally { await next.close(); }
  await f.close(journal);
  expect(nativeFacts(e.journalPath)).toMatchObject({ intents: [{ phase: mode === 'success' ? 'sourced' : 'pending' }],
    sources: [{ n: mode === 'success' ? 1 : 0 }], holds: [{ phase: mode === 'success' ? 'retained' : 'active' }], foreignKeys: [] });
});
it('a rejected actual control descriptor close forbids intent, source and release', async () => {
  const e = await nativeScenario(); let closes = 0;
  const ports = { ...nodePorts, open: async (...args: Parameters<typeof nodePorts.open>) => {
    const handle = await nodePorts.open(...args);
    return new Proxy(handle, { get(target, property) {
      if (property === 'close') return async () => { closes++; await target.close(); throw new Error('synthetic original close rejection'); };
      const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  const controller = new AttemptController({ journal: e.owner, supervisor: e.manager, input: { key: e.key, plan: e.plan },
    wallNow: e.time.wall, collectOutputs, createReader: options => new Reader(options, ports) });
  await controller.launch(operation()); e.backend.observation = e.backend.known('exited').value; e.time.advance(1);
  await expect(controller.tick(operation())).rejects.toMatchObject({ reason: 'cleanup' });
  await expect(controller.close()).rejects.toMatchObject({ reason: 'cleanup' }); expect(closes).toBe(2);
  expect(await e.owner.readOutputCollection(e.key)).toBeNull(); expect(await e.owner.readOutputSource(e.key)).toBeNull();
  expect(await e.owner.admission({ kind: 'reservation', key: e.key })).toMatchObject({ status: 'charged' });
});
