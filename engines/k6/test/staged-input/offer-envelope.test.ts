import { truncate, writeFile } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openStagedInput } from '../../wrapper/input/index.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import * as compiler from '../../compiler/suite/index.js';
import { fixture, hash, opened } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const openedPaths = vi.hoisted(() => [] as string[]);
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof Fs>();
  return { ...actual, open: async (path: string, flags: number) => {
    openedPaths.push(path); return actual.open(path, flags);
  } };
});
const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const value of fixtures.splice(0)) await value.cleanup(); });
async function setup() { const value = await fixture(); fixtures.push(value); return value; }
function fill(config: SuiteConfig, bytes: number): void {
  const chunks = Array.from({ length: 200 }, () => '🪲 café"\\'.repeat(200));
  config.requests[0]!.body = { kind: 'json', value: chunks };
  const size = () => Buffer.byteLength(JSON.stringify(config));
  while (bytes - size() > 4100) chunks.push('x'.repeat(4096));
  chunks.push(''); chunks[chunks.length - 1] = 'x'.repeat(bytes - size());
  expect(size()).toBe(bytes);
}
it('reads and actually compiles exact1MiB mixed UTF8 config in an Offer above1MiB', async () => {
  const value = await setup(); fill(value.offer.config as unknown as SuiteConfig, 1_048_576); await value.save();
  const raw = JSON.stringify(value.offer); expect(Buffer.byteLength(raw)).toBeGreaterThan(1_048_576);
  const session = await opened(value.options);
  expect(hash(JSON.stringify(session.offer))).toBe(hash(raw));
  const compile = session.compile(); const result = await compile.result; await compile.quiesced;
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.value.suite.requests).toHaveLength(1); expect(result.value.suite.datasets[0]!.rows).toEqual([{ name: 'one' }]); }
  await session.close();
});
it('rejects config+1 at Offer validation before the compiler', async () => {
  const value = await setup(); fill(value.offer.config as unknown as SuiteConfig, 1_048_577); await value.save();
  const compile = vi.spyOn(compiler, 'compileSuite'); const operation = openStagedInput(value.options);
  expect(await operation.result).toMatchObject({ ok: false, code: 'schema' }); await operation.quiesced;
  expect(compile).not.toHaveBeenCalled();
});
it('rejects an oversized staged Offer before opening/allocating its file content', async () => {
  const value = await setup(); const offerPath = join(value.options.inputRoot, 'offer.json');
  await truncate(offerPath, 2_097_153); openedPaths.length = 0;
  const operation = openStagedInput(value.options);
  expect(await operation.result).toEqual({ ok: false, code: 'filesystem' }); await operation.quiesced;
  expect(openedPaths).not.toContain(offerPath);
});
it('allows raw2MiB Offer padding independently of normalized config bytes', async () => {
  const value = await setup(); const json = JSON.stringify(value.offer);
  const raw = json + ' '.repeat(2_097_152 - Buffer.byteLength(json));
  value.staging.offerSha256 = hash(raw); await value.save(false);
  await writeFile(join(value.options.inputRoot, 'offer.json'), raw);
  const session = await opened(value.options); expect(session.offer).toEqual(value.offer); await session.close();
});
