import { expect, it } from 'vitest';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeName } from '../../src/backends/docker/index.js';
import { scope } from '../admission/fixtures.js';
import { fixture } from './fixtures.js';
const f = fixture();
it.each(['per-file', 'aggregate'])('enforces secret %s limits before the offending write and redacts errors', async kind => {
  const e = await f.environment(false);
  const count = kind === 'aggregate' ? 17 : 1;
  e.offer.secretReferences = Array.from({ length: count }, (_, index) => ({ name: `TOKEN${index}`, provider: 'mounted', reference: `opaque${index}` }));
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const value = Buffer.alloc(kind === 'aggregate' ? 65536 : 65537, 'SYNTHETIC_SENTINEL');
  let calls = 0;
  const task = e.prepare(e.create({ providers: { ...e.options.providers, secret: async request => {
    calls++; expect(Object.isFrozen(request.authority)).toBe(true); expect(Object.isFrozen(request.secret)).toBe(true); return value;
  } } }));
  const result = await task.result; await task.quiesced;
  expect(result).toEqual({ ok: false, reason: 'secret_limit' });
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SENTINEL');
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  const files = await readdir(join(e.rootPath, name, 'secrets')); expect(files).toHaveLength(kind === 'aggregate' ? 16 : 0);
  let total = 0; for (const file of files) total += (await lstat(join(e.rootPath, name, 'secrets', file))).size;
  expect(total).toBe(kind === 'aggregate' ? 1048576 : 0); expect(calls).toBe(count);
  expect(await readdir(join(e.rootPath, name, 'input'))).not.toContain('staging.json');
});
it('accepts empty values and exact secret limits without persisting a value digest', async () => {
  const e = await f.environment(false);
  e.offer.secretReferences = [{ name: 'EMPTY', provider: 'env', reference: 'opaque0' }, { name: 'FULL', provider: 'mounted', reference: 'opaque1' }];
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const task = e.prepare(e.create({ providers: { ...e.options.providers, secret: async request => Buffer.alloc(request.secret.name === 'EMPTY' ? 0 : 65536, 'z') } }));
  const result = await task.result; await task.quiesced; expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const root = join(e.rootPath, result.value.name);
  expect((await lstat(join(root, 'secrets/EMPTY'))).size).toBe(0);
  expect((await lstat(join(root, 'secrets/FULL'))).size).toBe(65536);
  expect(Object.keys(JSON.parse(await readFile(join(root, 'input/staging.json'), 'utf8'))).filter(key => key.toLowerCase().includes('secret'))).toEqual(['secretNames']);
});
