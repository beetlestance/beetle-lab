import {rawJournal} from '../journal/raw-connection.js';
import { expect, it, vi } from 'vitest';
import { chmod, link, lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeName, RuntimePlan } from '../../src/backends/docker/index.js';
import { serializeStagedOffer, estimateStaging } from '../../src/admission/index.js';
import { scope, configuration, reserved } from '../admission/fixtures.js';
import { data, fixture, hash, operation, stream } from './fixtures.js';

const f = fixture();
it('stages exact bytes, restrictive modes, hashes and shipped semantic metadata before a genuine plan', async () => {
  const e = await f.environment(false, 10_000);
  e.offer.budget.timeoutMs = 10_000;
  await e.owner.admission({ kind: 'configure', configuration: { ...configuration(), maxTimeoutMs: 10_000 } });
  e.offer.secretReferences = [{ name: 'TOKEN', provider: 'mounted', reference: 'opaque-ref' }];
  e.offer.inputs.push({ id: '00000000-0000-4000-8000-000000000099', bytes: 0, sha256: hash(Buffer.alloc(0)) });
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const stager = e.create({ providers: { input: async request => {
    if (request.input.bytes) await new Promise(resolve => setTimeout(resolve, 1100));
    return stream(request.input.bytes ? data : Buffer.alloc(0));
  }, secret: async () => Buffer.from('SYNTHETIC_SENTINEL') } });
  const task = e.prepare(stager, e.offer, 10_000); const result = await task.result; await task.quiesced;
  if (!result.ok) throw new Error(`Staging rejected: ${result.reason}`);
  expect(result.value).toBeInstanceOf(RuntimePlan);
  const root = join(e.rootPath, result.value.name);
  expect(await readdir(root)).toEqual(['input', 'output', 'secrets']);
  for (const path of [root, join(root, 'input'), join(root, 'output'), join(root, 'secrets')]) expect((await lstat(path)).mode & 0o777).toBe(0o700);
  expect(await readFile(join(root, 'input/input-000.bin'))).toEqual(data);
  expect(await readFile(join(root, 'input/input-001.bin'))).toEqual(Buffer.alloc(0));
  const offered = await readFile(join(root, 'input/offer.json'));
  expect(offered.toString()).toBe(serializeStagedOffer(e.offer));
  const manifest = await readFile(join(root, 'input/manifest.json'));
  const metadataText = await readFile(join(root, 'input/staging.json'), 'utf8');
  expect(metadataText).not.toContain('SYNTHETIC_SENTINEL');
  expect(JSON.parse(metadataText)).toMatchObject({ generation: 1, offerSha256: hash(offered), manifestSha256: hash(manifest),
    specDigest: result.value.specDigest, deadlineMs: 110000, stagingPolicyVersion: 1,
    inputFiles: e.offer.inputs.map((input, index) => ({ inputId: input.id, fileName: `input-${String(index).padStart(3, '0')}.bin` })), secretNames: ['TOKEN'] });
  for (const name of await readdir(join(root, 'input'))) {
    const stat = await lstat(join(root, 'input', name)); expect(stat.mode & 0o777).toBe(0o400); expect(stat.nlink).toBe(1);
  }
  expect(await readFile(join(root, 'secrets/TOKEN'), 'utf8')).toBe('SYNTHETIC_SENTINEL');
  expect((await lstat(join(root, 'secrets/TOKEN'))).mode & 0o777).toBe(0o400);
  expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toMatchObject({ status: 'charged', createToken: null, staging: estimateStaging(e.offer) });
});
it('retains the one-second admitted deadline while a slow input provider quiesces', async () => {
  const e = await f.environment();
  const stager = e.create({ providers: { ...e.options.providers, input: async () => {
    await new Promise(resolve => setTimeout(resolve, 1100)); return stream();
  } } });
  const task = e.prepare(stager);
  expect(await task.result).toEqual({ ok: false, reason: 'deadline' }); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect(await readdir(join(e.rootPath, name, 'input'))).toEqual([]);
});
it('checks reservation before first task write and rejects wrong scope/generation/profile/config', async () => {
  const e = await f.environment(false); const stager = e.create();
  let task = e.prepare(stager); expect((await task.result).ok).toBe(false); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  for (const key of [{ ...scope(e.offer), generation: 2 }, { ...scope(e.offer), workspaceId: e.offer.attemptId }]) {
    task = stager.prepare({ key, operation: operation() }); expect((await task.result).ok).toBe(false); await task.quiesced;
  }
  const badProfile = e.create({ validation: { ...e.options.validation, profileId: 'wrong' } });
  task = e.prepare(badProfile); expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
});
it.each(['short', 'overlong', 'digest', 'window'])('rejects %s input and preserves charged evidence without metadata', async kind => {
  const e = await f.environment();
  const values = { short: Buffer.from('x'), overlong: Buffer.concat([data, Buffer.from('x')]), digest: Buffer.alloc(data.length), window: Buffer.alloc(8_388_609) };
  const stager = e.create({ providers: { ...e.options.providers, input: async () => stream(values[kind as keyof typeof values]) } });
  const task = e.prepare(stager); expect(await task.result).toEqual({ ok: false, reason: 'input_integrity' }); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const names = await readdir(join(e.rootPath, name, 'input')); expect(names).not.toContain('staging.json');
  const stat = await lstat(join(e.rootPath, name, 'input/input-000.bin'));
  expect(stat.size).toBe(['overlong', 'window'].includes(kind) ? 0 : values[kind as keyof typeof values].length);
  expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toMatchObject({ status: 'charged', createToken: null });
});
it.each(['duplicate-input', 'duplicate-secret', 'case-secret', 'device-secret', 'dot-secret'])('rejects %s before task writes', async kind => {
  const e = await f.environment(false);
  if (kind === 'duplicate-input') e.offer.inputs.push({ ...e.offer.inputs[0]! });
  else {
    const names = { 'duplicate-secret': ['TOKEN', 'TOKEN'], 'case-secret': ['TOKEN', 'token'], 'device-secret': ['con'], 'dot-secret': ['trailing.'] };
    e.offer.secretReferences = names[kind as keyof typeof names].map(name => ({ name, provider: 'env', reference: 'opaque' }));
  }
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const task = e.prepare(e.create()); expect(await task.result).toEqual({ ok: false, reason: 'invalid_input' }); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
});
it.each(['file', 'symlink', 'partial'])('refuses existing %s task roots without altering them', async kind => {
  const e = await f.environment();
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const root = join(e.rootPath, name);
  if (kind === 'symlink') await symlink(e.rootPath, root);
  else if (kind === 'file') await writeFile(root, 'existing');
  else await mkdir(root, { mode: 0o700 });
  const task = e.prepare(e.create()); expect((await task.result).ok).toBe(false); await task.quiesced;
  expect((await lstat(root)).isSymbolicLink()).toBe(kind === 'symlink');
});
it('rejects provider-created symlinks and hard links with exclusive writes', async () => {
  const e = await f.environment();
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const inputPath = join(e.rootPath, name, 'input/input-000.bin');
  const stager = e.create({ providers: { ...e.options.providers, input: async () => {
    await symlink(join(e.rootPath, 'sentinel'), inputPath); return stream();
  } } });
  const task = e.prepare(stager); expect((await task.result).ok).toBe(false); await task.quiesced;
  expect((await lstat(inputPath)).isSymbolicLink()).toBe(true);
});
it('rejects a hardlink introduced by an input stream before its first write', async () => {
  const e = await f.environment();
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const path = join(e.rootPath, name, 'input/input-000.bin');
  async function* malicious() { await link(path, join(e.rootPath, 'alias')); yield data; }
  const task = e.prepare(e.create({ providers: { ...e.options.providers, input: async () => malicious() } }));
  expect(await task.result).toEqual({ ok: false, reason: 'io' }); await task.quiesced;
  expect((await lstat(path)).size).toBe(0);
});
it('requires pinned staging policy and exact charge even for existing charged rows', async () => {
  const path = f.path(); let owner = await f.configured(path); const e = await f.environment(false);
  await f.enqueue(owner, e.offer); await f.admit(owner, e.offer);
  const original = reserved(await owner.admission({ kind: 'reservation', key: scope(e.offer) }));
  await f.close(owner);
  const db = rawJournal(path, { enableForeignKeyConstraints: true });
  try {
    const rows = () => ['reservations', 'accepted_attempts', 'admission_queue', 'event_spool', 'supervision_clock',
      'disk_holds', 'disk_retention_stats', 'sqlite_sequence'].map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
    const before = rows();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.exec("UPDATE reservations SET reservation_json=json_remove(reservation_json,'$.staging')"))
      .toThrow('immutable disk reservation');
    expect(rows()).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  owner = await f.open(path);
  const malformed = structuredClone(original); Reflect.deleteProperty(malformed, 'staging');
  const admission = owner.admission.bind(owner);
  const reply = vi.spyOn(owner, 'admission').mockImplementation(input => input.kind === 'reservation'
    ? Promise.resolve(structuredClone(malformed)) : admission(input));
  const providers = { input: vi.fn(e.options.providers.input), secret: vi.fn(e.options.providers.secret) };
  try {
    const task = e.prepare(e.create({ journal: owner, providers }));
    expect(await task.result).toEqual({ ok: false, reason: 'reservation' }); await task.quiesced;
    expect(reply).toHaveBeenCalledWith({ kind: 'reservation', key: scope(e.offer) });
    expect(providers.input).not.toHaveBeenCalled(); expect(providers.secret).not.toHaveBeenCalled();
    expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
  } finally { reply.mockRestore(); }
  expect(await owner.admission({ kind: 'reservation', key: scope(e.offer) })).toEqual(original);
});

it('hashes a backpressured multichunk stream and refuses reuse of completed evidence', async () => {
  const e = await f.environment();
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const path = join(e.rootPath, name, 'input/input-000.bin');
  async function* segmented() {
    for (let offset = 0; offset < data.length; offset += 3) {
      expect((await lstat(path)).size).toBe(offset);
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      yield data.subarray(offset, Math.min(offset + 3, data.length));
    }
  }
  const stager = e.create({ providers: { ...e.options.providers, input: async () => segmented() } });
  const first = e.prepare(stager); const result = await first.result; await first.quiesced;
  expect(result.ok).toBe(true);
  const metadata = await readFile(join(e.rootPath, name, 'input/staging.json'));
  const repeat = e.prepare(stager); expect((await repeat.result).ok).toBe(false); await repeat.quiesced;
  expect(await readFile(join(e.rootPath, name, 'input/staging.json'))).toEqual(metadata);
});

it.each([0o644, 0o400])('rejects changed writable-stage mode %s before writing input bytes', async mode => {
  const e = await f.environment();
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const path = join(e.rootPath, name, 'input/input-000.bin');
  async function* changed() { await chmod(path, mode); yield data; }
  const task = e.prepare(e.create({ providers: { ...e.options.providers, input: async () => changed() } }));
  expect(await task.result).toEqual({ ok: false, reason: 'io' }); await task.quiesced;
  expect((await lstat(path)).size).toBe(0);
  expect(await readdir(join(e.rootPath, name, 'input'))).not.toContain('staging.json');
});
