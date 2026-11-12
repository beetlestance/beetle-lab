import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, native, resetNative } from '../attempt/fixtures.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => {await Promise.all(cleanups.splice(0).map(clean => clean()));});
async function setup() {const f = await fixture(); cleanups.push(f.cleanup); return f;}
it.each([false, true])('publishes text and CSV with actual mapped outcome (required failure=%s)', async failed => {
  const f = await setup(); native.failed = failed; const receipt = await f.run();
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  for (const kind of ['performance-report', 'metrics-csv']) {
    const artifacts = receipt.result!.artifacts.filter(artifact => artifact.kind === kind); expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0]!; const file = join(f.outputRoot, artifact.relativePath); const bytes = await readFile(file);
    expect(bytes.length).toBe(artifact.bytes); expect(artifact.bytes).toBeLessThanOrEqual(262144);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(bytes.toString()).toContain(failed ? 'failed' : 'passed'); expect(bytes.toString()).not.toContain('SECRET');
  }
  const manifest = JSON.parse(await readFile(join(f.outputRoot, 'engine-result.json'), 'utf8')) as {artifacts: unknown[]};
  expect(manifest.artifacts).toEqual(receipt.result!.artifacts);
});
it.each(['performance-report.txt', 'metrics.csv'])('refuses substituted %s without touching the secret or sealing a partial manifest', async name => {
  const f = await setup(); const secret = join(f.options.secretRoot, '_TOKEN'); const before = await readFile(secret);
  await symlink(secret, join(f.outputRoot, name)); const receipt = await f.run();
  expect(native.calls).toBe(1); expect(receipt.ok).toBe(false); expect(receipt.result).toBeNull();
  expect(await readFile(secret)).toEqual(before); expect(JSON.stringify(receipt)).not.toContain('SECRET');
  await expect(lstat(join(f.outputRoot, 'engine-result.json'))).rejects.toMatchObject({code: 'ENOENT'});
});
