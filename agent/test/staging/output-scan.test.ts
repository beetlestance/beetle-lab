import { writeFile, mkdir, open, symlink, link, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RuntimePlan } from '../../src/backends/docker/index.js';
import { scanOutput, scanOutputWithFiles } from '../../src/staging/output-scan.js';
import { scanFiles } from '../../src/staging/output-tree.js';
import { outputFixture, operation } from './output-fixtures.js';
import type { VerifiedRoot } from '../../src/staging/index.js';

const f = outputFixture();
it('counts a complete verified output tree, including pending dotfiles and directory allocation', async () => {
  const e = await f.prepared(); const nested = join(e.directory, 'data'); await mkdir(nested, { mode: 0o700 });
  await writeFile(join(nested, 'result.json'), 'payload', { mode: 0o600 });
  await writeFile(join(e.directory, '.engine-result.pending-test'), 'pending', { mode: 0o600 });
  const result = await scanOutput(e.options.root, e.request, operation());
  expect(result).toMatchObject({ kind: 'known' });
  if (result.kind !== 'known') throw new Error(result.kind);
  expect(result.logicalBytes).toBeGreaterThanOrEqual(14); expect(result.chargedBytes).toBeGreaterThanOrEqual(result.logicalBytes);
  expect(result.chargedBytes).toBeGreaterThanOrEqual(result.allocatedBytes); expect(result.freeBytes).toBeGreaterThan(0);
});
it('stops on logical sparse output size without buffering file contents', async () => {
  const e = await f.prepared(); const file = await open(join(e.directory, 'sparse'), 'wx', 0o600);
  try { await file.truncate(2_097_152); } finally { await file.close(); }
  expect(await scanOutput(e.options.root, e.request, operation())).toMatchObject({ kind: 'limit', reason: 'output' });
});
it('charges observed allocated space even when the logical file is small', async () => {
  const e = await f.prepared(); const path = join(e.directory, 'allocated'); await writeFile(path, 'x', { mode: 0o600 });
  const files = { ...scanFiles, async stat(name: string) {
    const value = await scanFiles.stat(name);
    return name === path ? Object.assign(Object.create(Object.getPrototypeOf(value)), value, { blocks: 4096n }) as typeof value : value;
  } };
  expect(await scanOutputWithFiles(e.options.root, e.request, operation(), files)).toMatchObject({ kind: 'limit', reason: 'output' });
});
it.each(['growth', 'truncate'] as const)('allows live file%s while conservatively counting both observations', async kind => {
  const e = await f.prepared(); const path = join(e.directory, 'live'); await writeFile(path, 'x'.repeat(8000), { mode: 0o600 });
  let first = true;
  const files = { ...scanFiles, async stat(name: string) {
    const value = await scanFiles.stat(name);
    if (name === path && first) {
      first = false; await writeFile(path, 'x'.repeat(kind === 'growth' ? 12000 : 1), { mode: 0o600 });
    }
    return value;
  } };
  const result = await scanOutputWithFiles(e.options.root, e.request, operation(), files);
  expect(result).toMatchObject({ kind: 'known' });
  if (result.kind === 'known') expect(result.logicalBytes).toBeGreaterThanOrEqual(kind === 'growth' ? 12000 : 8000);
});
it.each(['symlink', 'hardlink', 'permissions'] as const)('rejects unsafe%s metadata without reading contents', async kind => {
  const e = await f.prepared(); const path = join(e.directory, 'original'); await writeFile(path, 'data', { mode: 0o600 });
  if (kind === 'symlink') await symlink(path, join(e.directory, 'alias'));
  if (kind === 'hardlink') await link(path, join(e.directory, 'alias'));
  if (kind === 'permissions') await chmod(path, 0o644);
  expect(await scanOutput(e.options.root, e.request, operation())).toMatchObject({ kind: 'unknown', reason: 'custody' });
});
it('rejects bounded-tree overflow rather than returning a partial aggregate', async () => {
  const e = await f.prepared(); let path = e.directory;
  for (let depth = 0; depth < 8; depth++) { path = join(path, 'nested'); await mkdir(path, { mode: 0o700 }); }
  expect(await scanOutput(e.options.root, e.request, operation())).toMatchObject({ kind: 'unknown', reason: 'bounds' });
});
it('reports disk reserve breach, including zero available bytes', async () => {
  const e = await f.prepared(); const files = { ...scanFiles, async space(path: string) {
    return { ...await scanFiles.space(path), bavail: 0n };
  } };
  expect(await scanOutputWithFiles(e.options.root, e.request, operation(), files)).toMatchObject({ kind: 'limit', reason: 'disk' });
});
it('rejects forged authority, mismatched scope and getters before observing them', async () => {
  const e = await f.prepared(); let getters = 0;
  const fake = Object.create(RuntimePlan.prototype) as RuntimePlan;
  Object.defineProperty(fake, 'spec', { get() { getters++; return e.request.plan.spec; } });
  expect(await scanOutput(e.options.root, { ...e.request, plan: fake }, operation())).toMatchObject({ kind: 'unknown', reason: 'invalid_input' });
  expect(getters).toBe(0);
  const copied = Object.assign(Object.create(RuntimePlan.prototype), { name: e.request.plan.name, spec: e.request.plan.spec }) as RuntimePlan;
  Object.freeze(copied);
  expect(await scanOutput(e.options.root, { ...e.request, plan: copied }, operation())).toMatchObject({ kind: 'unknown', reason: 'invalid_input' });
  expect(await scanOutput({} as VerifiedRoot, e.request, operation())).toMatchObject({ kind: 'unknown', reason: 'custody' });
  expect(await scanOutput(e.options.root, { ...e.request, key: { ...e.request.key, generation: 2 } }, operation()))
    .toMatchObject({ kind: 'unknown', reason: 'invalid_input' });
});
