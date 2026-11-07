import { link, mkdir, rename, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStagedInput } from '../../wrapper/input/index.js';
import type { OpenStagedOptions } from '../../wrapper/input/index.js';
import { fixture, now, opened, uuid } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const fixtures: Fixture[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) { item.controller.abort(); await item.cleanup(); } });
async function setup(): Promise<Fixture> { const value = await fixture(); fixtures.push(value); return value; }
async function rejected(value: Fixture, code: string, options = value.options): Promise<void> {
  const operation = openStagedInput(options);
  expect(await operation.result).toMatchObject({ ok: false, code }); await operation.quiesced;
}
describe('staged headers', () => {
  it('opens independently constructed shipped-schema files, with immutable headers and admitted budget', async () => {
    const value = await setup(); const session = await opened(value.options);
    expect(session.attempt).toEqual({ mode: 'managed', timeoutMs: 60_000, deadlineMs: now + 60_000 });
    expect(Object.isFrozen(session.offer.config)).toBe(true);
    expect(Object.isFrozen(session.staging.inputFiles[0])).toBe(true);
    await session.close();
  });
  it.each(['staging.json', 'offer.json', 'manifest.json'])('rejects corrupt JSON in %s', async name => {
    const value = await setup(); await writeFile(join(value.options.inputRoot, name), '{PRIVATE_CORRUPT');
    await rejected(value, 'schema');
  });
  it.each([['staging.json', 65_537], ['offer.json', 1_048_577], ['manifest.json', 65_537]] as const)('bounds %s before allocation', async (name, size) => {
    const value = await setup(); await truncate(join(value.options.inputRoot, name), size);
    await rejected(value, 'filesystem');
  });
  it.each(['organizationId', 'workspaceId', 'attemptId', 'intentDigest'] as const)('binds Offer %s', async field => {
    const value = await setup(); value.staging[field] = field === 'intentDigest' ? 'd'.repeat(64) : uuid(91);
    await value.save(); await rejected(value, 'binding');
  });
  it.each(['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest', 'specDigest', 'offerSha256', 'manifestSha256'] as const)('checks trusted expected %s', async field => {
    const value = await setup(); const actual = value.staging[field];
    const mismatch = typeof actual === 'number' ? actual + 1 : field.endsWith('Id') ? uuid(90) : 'd'.repeat(64);
    await rejected(value, 'binding', { ...value.options, expected: { [field]: mismatch } });
  });
  it.each(['offerSha256', 'manifestSha256'] as const)('pins exact raw %s bytes', async field => {
    const value = await setup(); value.staging[field] = 'd'.repeat(64); await value.save(false); await rejected(value, 'binding');
  });
  it('rejects raw byte changes even when parsed JSON is identical', async () => {
    const value = await setup(); await writeFile(join(value.options.inputRoot, 'offer.json'), JSON.stringify(value.offer) + '\n');
    await rejected(value, 'binding');
  });
  it.each(['image', 'version', 'engine', 'schema', 'result', 'configVersion', 'capability', 'budget'])('binds installed %s identity', async which => {
    const value = await setup();
    if (which === 'image') value.manifest.imageDigest = 'sha256:' + 'f'.repeat(64);
    if (which === 'version') value.manifest.engineVersion = 'untrusted';
    if (which === 'engine') value.offer.engine.id = 'other';
    if (which === 'schema') value.manifest.schemas.config = 'https://example.invalid/fixture-schema';
    if (which === 'result') value.manifest.schemas.result = 'https://example.invalid/result' as never;
    if (which === 'configVersion') value.offer.engine.configVersion++;
    if (which === 'capability') value.offer.requiredCapabilities.push('unsupported');
    if (which === 'budget') value.offer.budget.memoryBytes = 1;
    await value.save(); await rejected(value, which === 'result' ? 'schema' : 'binding');
  });
  it.each(['missing', 'wrongId', 'wrongIndex', 'duplicate', 'caseDuplicate'])('requires ordered bijection: %s', async which => {
    const value = await setup();
    if (which === 'missing') value.staging.inputFiles = [];
    if (which === 'wrongId') value.staging.inputFiles[0]!.inputId = uuid(99);
    if (which === 'wrongIndex') value.staging.inputFiles[0]!.fileName = 'input-001.bin';
    if (which === 'duplicate') { value.offer.inputs.push({ ...value.offer.inputs[0]! }); value.staging.inputFiles.push({ inputId: uuid(5), fileName: 'input-001.bin' }); }
    if (which === 'caseDuplicate') {
      value.offer.inputs[0]!.id = 'aaaaaaaa-0000-4000-8000-000000000005';
      value.staging.inputFiles[0]!.inputId = value.offer.inputs[0]!.id;
      value.offer.inputs.push({ ...value.offer.inputs[0]!, id: value.offer.inputs[0]!.id.toUpperCase() });
      value.staging.inputFiles.push({ inputId: value.offer.inputs[1]!.id, fileName: 'input-001.bin' });
    }
    await value.save(); await rejected(value, 'binding');
  });
  it.each(['input', 'secret'])('rejects extra entries under %s root', async root => {
    const value = await setup(); const path = root === 'input' ? value.options.inputRoot : value.options.secretRoot;
    await writeFile(join(path, 'EXTRA'), 'private'); await rejected(value, 'binding');
  });
  it.each(['_OTHER', '_token', 'CON', 'trailing.'])('rejects secret set/collision/portable name %s', async name => {
    const value = await setup();
    value.offer.secretReferences!.push({ name, provider: 'mounted', reference: 'other' });
    if (name !== '_OTHER') value.staging.secretNames.push(name);
    await value.save(); await rejected(value, 'secret_binding');
  });
  it('bounds secret sizes and aggregate without opening values', async () => {
    const value = await setup(); await truncate(join(value.options.secretRoot, '_TOKEN'), 65_537);
    await rejected(value, 'filesystem');
    await truncate(join(value.options.secretRoot, '_TOKEN'), 65_536);
    for (let i = 0; i < 16; i++) {
      const name = `SECRET_${i}`;
      value.offer.secretReferences!.push({ name, provider: 'env', reference: name }); value.staging.secretNames.push(name);
      await writeFile(join(value.options.secretRoot, name), new Uint8Array(65_536));
    }
    await value.save(); await rejected(value, 'input_limit');
  });
  it.each(['symlink', 'hardlink', 'directory'])('rejects secret %s', async kind => {
    const value = await setup(); const path = join(value.options.secretRoot, '_TOKEN');
    await rename(path, join(value.root, 'original'));
    if (kind === 'symlink') await symlink(join(value.root, 'original'), path);
    if (kind === 'hardlink') await link(join(value.root, 'original'), path);
    if (kind === 'directory') await mkdir(path);
    await rejected(value, 'filesystem');
  });
  it('rejects root symlinks and wrong owner', async () => {
    const value = await setup(); const alias = join(value.root, 'alias'); await symlink(value.options.inputRoot, alias);
    await rejected(value, 'filesystem', { ...value.options, inputRoot: alias });
    await rejected(value, 'filesystem', { ...value.options, uid: value.options.uid + 1 });
  });
  it.each([0, 60_001, NaN])('requires trusted bounded opening timeout %s', async headerTimeoutMs => {
    const value = await setup(); await rejected(value, 'binding', { ...value.options, headerTimeoutMs });
  });
  it('does not accept synthetic fixture schema as installed authority', async () => {
    const value = await setup();
    const installed = { ...value.options.installed, configSchema: 'https://example.invalid/schema' } as unknown as OpenStagedOptions['installed'];
    await rejected(value, 'binding', { ...value.options, installed });
  });
});
