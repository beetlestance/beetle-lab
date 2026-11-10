import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installationStatePath, openAgentRuntime } from '../../src/bootstrap/index.js';
import { openRestoringState, openServingState } from '../../src/installation-state/index.js';
import { Journal } from '../../src/journal/index.js';
import type { DockerReply } from '../../src/backends/docker/index.js';
import { deferred } from '../supervisor/fixtures.js';
import { fixture } from './fixtures.js';

const f = fixture();
it('serves actual Journal absence proof and source marker through authenticated production runtime HTTP wiring', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
  const origin = await runtime.server.listen({ host: '127.0.0.1', port: 0 });
  const path = `/runner/v1/attempts/${e.offer.attemptId}`;
  try {
    const refused = await fetch(origin + path + '/cancel-original', { method: 'POST', headers: { ...e.headers, 'content-type': 'application/json' },
      body: JSON.stringify(e.offer) });
    expect(refused.status).toBe(200);
    const response = await fetch(origin + path + '/source/absence', { headers: e.headers });
    expect(response.status).toBe(200); const body = await response.text(); expect(Buffer.byteLength(body)).toBeLessThanOrEqual(2048);
    const proof = JSON.parse(body) as { journalAuthority: string; finalAgentSeq: number };
    expect(proof).toMatchObject({ journalAuthority: e.journalAuthority, finalAgentSeq: 0,
      admission: { state: 'rejected', reason: 'cancelled' }, reason: 'cancelled' });
    const marker = await fetch(origin + path + '/source', { headers: e.headers });
    expect(marker.status).toBe(409); expect(await marker.json()).toMatchObject({ reason: 'source_absent', retry: 'never' });
    const denied = await fetch(origin + path + '/source/absence', { headers: { ...e.headers, authorization: 'Bearer ' + 'X'.repeat(64) } });
    expect(denied.status).toBe(401); expect(e.daemon.mutations()).toHaveLength(0);
  } finally { await runtime.close(); }
  const journal = await f.open(e.journalPath);
  expect(await journal.readOutputAbsence({ organizationId: e.offer.organizationId, workspaceId: e.offer.workspaceId,
    attemptId: e.offer.attemptId, generation: 1 })).toMatchObject({ journalAuthority: e.journalAuthority, finalAgentSeq: 0 });
});
function database<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { timeout: 100 });
  try { return read(db); } finally { db.close(); }
}
function settings(path: string) {
  return database(path, db => db.prepare('SELECT * FROM admission_settings').all());
}
function assertOwned(path: string): void {
  expect(() => openServingState(installationStatePath(path))).toThrow('owned');
  expect(() => openRestoringState(installationStatePath(path))).toThrow('owned');
  database(installationStatePath(path), db => {
    expect(() => db.prepare('SELECT * FROM installation_state').get()).toThrow();
  });
}
function assertReleased(path: string): void {
  const serving = openServingState(installationStatePath(path));
  try { expect(serving.journalAuthority).toMatch(/^[0-9a-f-]{36}$/u); } finally { serving.close(); }
}

it('binds the installed ready gate to the actual journal across ordinary runtime reopen', async () => {
  const e = await f.setup(); const journal = await f.open(e.journalPath);
  const original = await journal.journalAuthority(); await f.close(journal);
  expect(installationStatePath(e.journalPath)).toBe(e.journalPath + '.authority.sqlite');
  for (let n = 0; n < 2; n++) {
    const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true });
    assertOwned(e.journalPath); await runtime.close();
    const gate = openServingState(installationStatePath(e.journalPath));
    try { expect(gate.journalAuthority).toBe(original); gate.assertJournalAuthority(original); } finally { gate.close(); }
  }
});

it.each(['missing', 'initializing', 'restoring', 'corrupt'] as const)(
  'rejects %s gate before foreign verification, journal recovery or service effects', async phase => {
    const e = await f.setup(); const path = installationStatePath(e.journalPath);
    if (phase === 'missing') await rename(path, path + '.retained');
    if (phase === 'initializing') database(path, db => {
      db.prepare("UPDATE installation_state SET phase='initializing',operation_id=?,authority=NULL,pending=NULL").run(randomUUID());
    });
    if (phase === 'restoring') {
      const restore = openRestoringState(path); try { restore.begin(randomUUID()); } finally { restore.close(); }
    }
    if (phase === 'corrupt') database(path, db => { db.exec('DROP TABLE installation_state'); });
    const before = await readFile(e.journalPath); const beforeSettings = settings(e.journalPath);
    const request = vi.fn(e.options.transport.request);
    await expect(openAgentRuntime({ ...e.options, transport: { request } })).rejects.toMatchObject({ reason: 'startup' });
    expect(request).not.toHaveBeenCalled(); expect(e.daemon.mutations()).toHaveLength(0);
    expect(settings(e.journalPath)).toEqual(beforeSettings); expect(await readFile(e.journalPath)).toEqual(before);
    if (phase === 'missing') await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(() => openServingState(path)).toThrow('recovery_required');
  });

it.each(['relative', 'alias', 'oversized'] as const)('rejects %s gate paths before foreign work', async shape => {
  const e = await f.setup(); let path = 'relative.sqlite';
  if (shape === 'alias') {
    const alias = join(e.rootPath, 'journal-parent-alias'); await symlink(resolve(e.journalPath, '..'), alias);
    path = join(alias, e.journalPath.split('/').at(-1)!);
  }
  if (shape === 'oversized') path = '/' + 'x'.repeat(4096);
  const request = vi.fn(e.options.transport.request);
  await expect(openAgentRuntime({ ...e.options, journal: { ...e.options.journal, path }, transport: { request } }))
    .rejects.toMatchObject({ reason: 'startup' });
  expect(request).not.toHaveBeenCalled(); assertReleased(e.journalPath);
});

it.each(['reset', 'null', 'missing'] as const)('refuses %s journal authority before admission or composition', async damage => {
  const e = await f.setup();
  if (damage === 'reset') {
    await rename(e.journalPath, e.journalPath + '.retained');
    const fresh = await f.open(e.journalPath); await f.close(fresh);
  } else database(e.journalPath, db => {
    if (damage === 'null') db.exec('DROP TRIGGER journal_authority_no_update; UPDATE journal_authority SET authority=NULL;');
    if (damage === 'missing') db.exec('DROP TRIGGER journal_authority_no_delete; DELETE FROM journal_authority;');
  });
  const before = database(e.journalPath, db => db.prepare('SELECT configuration_json FROM admission_settings').all());
  e.options.configuration.maxConcurrent = 1;
  await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'startup' });
  expect(database(e.journalPath, db => db.prepare('SELECT configuration_json FROM admission_settings').all())).toEqual(before);
  expect(e.daemon.mutations()).toHaveLength(0);
  assertReleased(e.journalPath);
  const journal = await f.open(e.journalPath);
  if (damage === 'reset') {
    const actual = await journal.journalAuthority(); const gate = openServingState(installationStatePath(e.journalPath));
    try { expect(actual).not.toBe(gate.journalAuthority); } finally { gate.close(); }
  } else await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'recovery_required' });
  await f.close(journal);
});

it.each(['abort', 'failure'] as const)('retains original verification and its gate through startup %s', async outcome => {
  const e = await f.setup(); const held = deferred<DockerReply>(); const abort = new AbortController();
  const request = vi.fn(() => held.promise);
  const opening = openAgentRuntime({ ...e.options, signal: abort.signal, transport: { request } });
  const rejected = expect(opening).rejects.toMatchObject({ reason: 'startup' });
  await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce(); });
  if (outcome === 'abort') abort.abort();
  assertOwned(e.journalPath); await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  held.resolve({ ok: false, reason: 'unavailable', dispatched: true }); await rejected;
  assertReleased(e.journalPath);
  const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true }); await runtime.close();
});

it('uses the captured journal path even when caller options change during verification', async () => {
  const e = await f.setup(); const other = await f.setup(); const originalPath = e.journalPath;
  const held = deferred<void>(); let entered = false;
  const opening = openAgentRuntime({ ...e.options, transport: { async request(input) {
    if (!entered) { entered = true; await held.promise; }
    return e.options.transport.request(input);
  } } });
  const before = settings(other.journalPath);
  try {
    await vi.waitFor(() => { expect(entered).toBe(true); }); e.options.journal.path = other.journalPath;
  } finally { held.resolve(); }
  const runtime = f.keep(await opening); expect(await runtime.initial).toEqual({ ready: true });
  assertOwned(originalPath); expect(settings(other.journalPath)).toEqual(before); await runtime.close();
  assertReleased(originalPath);
});

it('retains a pending actual journal authority read on startup abort before admission', async () => {
  const e = await f.setup(); const before = settings(e.journalPath)[0]?.configuration_json;
  const held = deferred<void>(); let entered = false; const abort = new AbortController();
  const original = Journal.prototype.journalAuthority;
  const authority = vi.spyOn(Journal.prototype, 'journalAuthority').mockImplementation(async function (this: Journal) {
    const actual = await original.call(this); entered = true; await held.promise; return actual;
  });
  const opening = openAgentRuntime({ ...e.options, signal: abort.signal });
  const rejected = expect(opening).rejects.toMatchObject({ reason: 'startup' });
  try {
    await vi.waitFor(() => { expect(entered).toBe(true); }); abort.abort(); assertOwned(e.journalPath);
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  } finally { held.resolve(); await rejected; authority.mockRestore(); }
  expect(settings(e.journalPath)[0]?.configuration_json).toBe(before); assertReleased(e.journalPath);
});

it('holds the gate until deferred original server shutdown completes', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
  const held = deferred<void>(); let entered = false;
  runtime.server.addHook('onClose', async () => { entered = true; await held.promise; });
  const closing = runtime.close();
  try {
    await vi.waitFor(() => { expect(entered).toBe(true); }); assertOwned(e.journalPath);
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  } finally { held.resolve(); await closing; }
  assertReleased(e.journalPath);
});

it('holds the gate and process owner through the original journal native close', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
  const held = deferred<void>(); let entered = false; const original = Journal.prototype.close;
  const close = vi.spyOn(Journal.prototype, 'close').mockImplementation(async function (this: Journal) {
    entered = true; await held.promise; await original.call(this);
  });
  const closing = runtime.close();
  try {
    await vi.waitFor(() => { expect(entered).toBe(true); }); assertOwned(e.journalPath);
    database(e.journalPath, db => { expect(() => db.prepare('SELECT * FROM admission_settings').get()).toThrow(); });
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  } finally { held.resolve(); await closing; close.mockRestore(); }
  assertReleased(e.journalPath);
});

function failureSource(e: Awaited<ReturnType<typeof f.setup>>, failure: string): string {
  const engine = e.options.catalog.engines[0]!;
  return `
import assert from 'node:assert/strict';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { createConfigSchema } from ${JSON.stringify(resolve('contracts/src/engine-config/index.ts'))};
import { openAgentRuntime, installationStatePath } from ${JSON.stringify(resolve('agent/src/bootstrap/index.ts'))};
import { createEngineCatalog } from ${JSON.stringify(resolve('agent/src/catalog/index.ts'))};
import { openServingState } from ${JSON.stringify(resolve('agent/src/installation-state/index.ts'))};
import { Journal } from ${JSON.stringify(resolve('agent/src/journal/index.ts'))};
const input = ${JSON.stringify({ journal: { path: e.journalPath }, installation: e.options.installation,
    configuration: e.options.configuration, credential: e.options.credential, minimumFreeBytes: 0 })};
input.journal.workerUrl = new URL(${JSON.stringify(f.workerUrl().href)});
const engine = ${JSON.stringify({ manifest: engine.manifest, profile: engine.profile, validation: engine.validation })};
const schema = createConfigSchema({schemas:[{$id:engine.manifest.schemas.config,type:'object'}],
  schemaId:engine.manifest.schemas.config,digest:()=>engine.validation.schemaDigest});
input.catalog = createEngineCatalog([{...engine,configVersion:1,configSchema:schema}]);
input.providers = { input:async function*(){}, secret:async()=>new Uint8Array() };
input.transport = {request:async request=>{
  if (request.path.endsWith('/info')) return {ok:true,status:200,body:${JSON.stringify({ ...e.transport.info,
    Architecture: 'aarch64', NCPU: 14, MemTotal: 16 * 1024 ** 3, DefaultRuntime: 'runc' })}};
  if (request.path.includes('/images/')) return {ok:true,status:200,body:${JSON.stringify({ Id: engine.profile.imageDigest,
    Os: 'linux', Architecture: 'arm64', Config: { Env: engine.profile.effectiveImage.environment } })}};
  if (request.path.endsWith('/json')) return {ok:true,status:200,body:${JSON.stringify(e.transport.agent)}};
  return {ok:false,reason:'unavailable',dispatched:false};
}};
const failure = ${JSON.stringify(failure)};
if (failure === 'gate-read') {
  const all = StatementSync.prototype.all; let reads = 0;
  StatementSync.prototype.all = function(...args) {
    if (this.sourceSQL.includes('FROM installation_state') && ++reads === 3) throw Error('synthetic final state read');
    return all.apply(this,args);
  };
  await assert.rejects(openAgentRuntime(input),{reason:'startup'});
  assert.equal(reads,3,'injected the third control-state read');
  StatementSync.prototype.all = all;
  const recovered = await openAgentRuntime(input); await recovered.initial; await recovered.close();
  console.log('recovered failed initial state read without retained lease'); process.exit(0);
}
let runtime;
if (failure === 'gate-acquisition') {
  DatabaseSync.prototype.close=function(){throw Error('synthetic acquisition close');};
  await assert.rejects(openAgentRuntime(input),{reason:'cleanup'});
} else { runtime = await openAgentRuntime(input); await runtime.initial; }
if (failure === 'service') runtime.server.addHook('onClose',async()=>{throw Error('synthetic service close');});
if (failure === 'journal') Journal.prototype.close=async()=>{throw Error('synthetic journal close');};
if (failure === 'gate') DatabaseSync.prototype.close=function(){throw Error('synthetic gate close');};
if (runtime) await assert.rejects(runtime.close(),{reason:'cleanup'});
await assert.rejects(openAgentRuntime(input),{reason:'busy'});
assert.throws(()=>openServingState(installationStatePath(input.journal.path)),/owned/);
const gate = new DatabaseSync(installationStatePath(input.journal.path),{timeout:100});
assert.throws(()=>gate.prepare('SELECT * FROM installation_state').get());
console.log('retained original runtime and exclusive gate');
process.exit(0);
`;
}
async function failureChild(e: Awaited<ReturnType<typeof f.setup>>, failure: string): Promise<string> {
  const script = join(e.rootPath, `retained-${failure}.mjs`);
  await writeFile(script, failureSource(e, failure), { mode: 0o600 });
  const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', script],
    { cwd: process.cwd(), timeout: 15_000, maxBuffer: 65_536 });
  return child.stdout;
}
// Failed owners intentionally survive until process exit; isolate them without reset/retry cleanup.
it.each(['service', 'journal', 'gate', 'gate-acquisition'] as const)('retains runtime and gate ownership after %s cleanup failure', async failure => {
  const e = await f.setup();
  if (failure === 'gate-acquisition') database(installationStatePath(e.journalPath), db => {
    db.prepare("UPDATE installation_state SET phase='initializing',operation_id=?,authority=NULL,pending=NULL").run(randomUUID());
  });
  expect(await failureChild(e, failure)).toContain('retained original runtime and exclusive gate');
}, 20_000);
it('releases a failed initial state read and permits a complete healthy retry', async () => {
  const e = await f.setup();
  expect(await failureChild(e, 'gate-read')).toContain('recovered failed initial state read without retained lease');
}, 20_000);
