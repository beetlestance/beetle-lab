import { writeFile } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '@beetle/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import * as compiler from '../../compiler/suite/index.js';
import { openStagedInput } from '../../wrapper/input/index.js';
import { fixture, hash, opened, syntheticInstalledIdentity } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const io = vi.hoisted(() => ({ opened: [] as string[], inspected: [] as string[] }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof Fs>();
  return { ...actual,
    open: async (path: string, flags: number) => { io.opened.push(path); return actual.open(path, flags); },
    lstat: async (path: string) => { io.inspected.push(path); return actual.lstat(path); },
  };
});
const fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); io.opened.length = 0; io.inspected.length = 0;
  for (const value of fixtures.splice(0)) { value.controller.abort(); await value.cleanup(); }
});
async function setup(): Promise<Fixture> { const value = await fixture(); fixtures.push(value); return value; }
async function rejectBeforeEffects(value: Fixture, code = 'binding'): Promise<void> {
  io.opened.length = 0; io.inspected.length = 0;
  const compile = vi.spyOn(compiler, 'compileSuite');
  const operation = openStagedInput(value.options);
  expect(await operation.result).toEqual({ ok: false, code }); await operation.quiesced;
  expect(compile).not.toHaveBeenCalled();
  expect(io.opened).not.toContain(join(value.options.inputRoot, 'input-000.bin'));
  expect(io.opened).not.toContain(join(value.options.secretRoot, '_TOKEN'));
  expect(io.inspected).not.toContain(join(value.options.secretRoot, '_TOKEN'));
}
it.each(['network', 'phase', 'minimum'] as const)('rejects changed complete manifest %s semantics with correct raw hashes', async field => {
  const value = await setup(); const identity = value.offer.installedIdentity;
  const selector = { ...value.offer.engine }; const version = value.manifest.engineVersion;
  if (field === 'network') value.manifest.network = { required: false, profile: 'none' };
  if (field === 'phase') value.manifest.phases[0]!.workUnits++;
  if (field === 'minimum') value.manifest.minimumBudget.pids--;
  await value.save();
  expect(validate('EngineManifest', value.manifest).ok).toBe(true);
  expect(validate('Offer', value.offer).ok).toBe(true);
  expect(value.offer.engine).toEqual(selector); expect(value.manifest.engineVersion).toBe(version);
  expect(value.manifest.imageDigest).toBe(selector.imageDigest);
  expect(value.staging.offerSha256).toBe(hash(JSON.stringify(value.offer)));
  expect(value.staging.manifestSha256).toBe(hash(JSON.stringify(value.manifest)));
  expect(value.offer.installedIdentity).toBe(identity);
  await rejectBeforeEffects(value);
});
it('rejects a changed installed manifestDigest even when raw Offer integrity is correct', async () => {
  const value = await setup();
  value.offer.installedIdentity = { ...value.offer.installedIdentity, manifestDigest: 'e'.repeat(64) };
  await value.save(); expect(validate('Offer', value.offer).ok).toBe(true);
  await rejectBeforeEffects(value);
});
it('rejects an unbound Offer before compiler, dataset or secret inspection', async () => {
  const value = await setup(); Reflect.deleteProperty(value.offer, 'installedIdentity'); await value.save();
  await rejectBeforeEffects(value, 'schema');
});
it('accepts reordered manifest JSON while preserving the complete installed binding', async () => {
  const value = await setup();
  const raw = JSON.stringify(Object.fromEntries(Object.entries(value.manifest).reverse()), null, 2);
  value.staging.manifestSha256 = hash(raw); await value.save(false);
  await writeFile(join(value.options.inputRoot, 'manifest.json'), raw);
  const session = await opened(value.options);
  expect(session.offer.installedIdentity).toEqual(value.offer.installedIdentity);
  expect(Object.isFrozen(session.offer.installedIdentity)).toBe(true); await session.close();
});
it('models a deliberate new synthetic installation only through explicit rebinding', async () => {
  const value = await setup(); value.manifest.network = { required: false, profile: 'none' };
  const prior = value.offer.installedIdentity;
  value.offer.installedIdentity = syntheticInstalledIdentity(value.manifest); await value.save();
  expect(value.offer.installedIdentity.manifestDigest).not.toBe(prior.manifestDigest);
  const session = await opened(value.options); await session.close();
});
