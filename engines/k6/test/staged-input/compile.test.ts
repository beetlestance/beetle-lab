import { link, rename, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as compiler from '../../compiler/suite/index.js';
import * as validation from '../../compiler/suite/validation.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import { fixture, hash, opened, uuid } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const value of fixtures.splice(0)) { value.controller.abort(); await value.cleanup(); } });
async function setup(): Promise<Fixture> { const value = await fixture(); fixtures.push(value); return value; }
async function compileRejected(value: Fixture, code: string): Promise<void> {
  const session = await opened(value.options); const operation = session.compile();
  expect(await operation.result).toMatchObject({ ok: false, code }); await operation.quiesced;
  await session.close();
}
describe('explicit admitted compilation', () => {
  it('does no compiler work until explicit call, invokes the existing compiler once and freezes results', async () => {
    const value = await setup(); const compile = vi.spyOn(compiler, 'compileSuite');
    const validate = vi.spyOn(validation, 'validateSuiteConfig');
    const session = await opened(value.options);
    expect(compile).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
    const operation = session.compile();
    expect(await session.compile().result).toEqual({ ok: false, code: 'already_compiled' });
    const result = await operation.result; await operation.quiesced;
    expect(result.ok).toBe(true); expect(compile).toHaveBeenCalledTimes(1); expect(validate).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.suite.datasets[0]!.rows).toEqual([{ name: 'one' }]);
      expect(Object.isFrozen(result.value.suite.requests)).toBe(true);
      expect(result.value.attempt).toBe(session.attempt);
    }
    expect(await session.compile().result).toEqual({ ok: false, code: 'already_compiled' });
    await session.close(); expect(await session.compile().result).toEqual({ ok: false, code: 'closed' });
  });
  it('does not read an input during header open', async () => {
    const value = await setup(); const path = join(value.options.inputRoot, 'input-000.bin');
    await rename(path, join(value.root, 'unread-input')); await symlink(join(value.root, 'unread-input'), path);
    const session = await opened(value.options);
    const operation = session.compile(); expect(await operation.result).toMatchObject({ ok: false, code: 'filesystem' });
    await operation.quiesced; await session.close();
  });
  it.each(['hash', 'short', 'long'])('checks actual input %s against declared bytes/hash', async which => {
    const value = await setup(); const path = join(value.options.inputRoot, 'input-000.bin');
    if (which === 'hash') await writeFile(path, '[{"name":"two"}]');
    if (which === 'short') await truncate(path, 2);
    if (which === 'long') await writeFile(path, '[{"name":"one"}] ');
    await compileRejected(value, 'input_integrity');
  });
  it('decodes UTF-8 fatally and preserves raw byte hashing', async () => {
    const value = await setup(); const bytes = new Uint8Array([0xc3, 0x28]);
    value.offer.inputs[0]!.bytes = bytes.byteLength; value.offer.inputs[0]!.sha256 = hash(bytes);
    const config = value.offer.config as unknown as SuiteConfig;
    config.datasets = [{ id: 'users', kind: 'json', selection: 'byVu', input: { ...value.offer.inputs[0]! } }];
    await writeFile(join(value.options.inputRoot, 'input-000.bin'), bytes); await value.save();
    await compileRejected(value, 'utf8');
  });
  it('does not silently strip a UTF-8 BOM before compiler integrity checks', async () => {
    const value = await setup(); const content = '\ufeff[{"name":"one"}]';
    value.offer.inputs[0]!.bytes = Buffer.byteLength(content); value.offer.inputs[0]!.sha256 = hash(content);
    const config = value.offer.config as unknown as SuiteConfig;
    config.datasets = [{ id: 'users', kind: 'json', selection: 'byVu', input: { ...value.offer.inputs[0]! } }];
    await writeFile(join(value.options.inputRoot, 'input-000.bin'), content); await value.save();
    const session = await opened(value.options); const operation = session.compile(); const result = await operation.result;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suite.identity.inputs[0]).toEqual(value.offer.inputs[0]);
    await operation.quiesced; await session.close();
  });
  it.each(['perInput', 'aggregate'])('rejects declared %s limits before reading datasets', async which => {
    const value = await setup();
    value.offer.inputs[0]!.bytes = which === 'perInput' ? 8_388_609 : 8_388_608;
    if (which === 'aggregate') for (let i = 1; i < 5; i++) {
      value.offer.inputs.push({ ...value.offer.inputs[0]!, id: uuid(5 + i) });
      value.staging.inputFiles.push({ inputId: uuid(5 + i), fileName: `input-00${i}.bin` });
      await writeFile(join(value.options.inputRoot, `input-00${i}.bin`), 'unread');
    }
    await value.save(); await compileRejected(value, 'input_limit');
  });
  it('bounds actual file size even when Offer declares a small input', async () => {
    const value = await setup(); await truncate(join(value.options.inputRoot, 'input-000.bin'), 8_388_609);
    await compileRejected(value, 'filesystem');
  });
  it('checks config dependencies instead of normalizing Offer URNs', async () => {
    const value = await setup(); value.offer.inputs[0]!.id = 'urn:uuid:' + uuid(5);
    value.staging.inputFiles[0]!.inputId = value.offer.inputs[0]!.id; await value.save();
    const session = await opened(value.options);
    expect(session.offer.inputs[0]!.id).toBe('urn:uuid:' + uuid(5));
    const operation = session.compile(); expect(await operation.result).toMatchObject({ ok: false, code: 'invalid_config' });
    await operation.quiesced; await session.close();
  });
  it('rejects conflicting config/Offer input metadata with the single compiler', async () => {
    const value = await setup(); const config = value.offer.config as unknown as SuiteConfig;
    config.datasets = [{ id: 'users', kind: 'json', selection: 'byVu', input: { ...value.offer.inputs[0]!, id: uuid(10) } }];
    await value.save(); await compileRejected(value, 'invalid_config');
  });
  it.each(['version', 'provider', 'locator', 'name'] as const)('requires exact config secret %s references', async field => {
    const value = await setup(); const config = value.offer.config as unknown as SuiteConfig;
    config.secrets[0]![field] = field === 'provider' ? 'env' : 'other';
    await value.save(); await compileRejected(value, 'secret_binding');
  });
  it('rejects semantic template failures before native/readiness and emits bounded safe issues', async () => {
    const value = await setup(); const config = value.offer.config as unknown as SuiteConfig;
    config.requests[0]!.path = '/{{secret.PRIVATE_INPUT_SENTINEL}}'; await value.save();
    const session = await opened(value.options); const operation = session.compile(); const result = await operation.result;
    expect(result).toMatchObject({ ok: false, code: 'invalid_config', issues: [{ code: 'missing_dependency' }] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INPUT_SENTINEL'); await operation.quiesced; await session.close();
  });
  it.each(['abort', 'deadline'])('suppresses actual compiler success after %s during compilation', async cause => {
    const value = await setup(); let wall = 1_800_000_000_000;
    const session = await opened({ ...value.options, wallNow: () => wall }); const original = compiler.compileSuite;
    vi.spyOn(compiler, 'compileSuite').mockImplementationOnce((config, options) => {
      const result = original(config, options); expect(result.ok).toBe(true);
      if (cause === 'abort') value.controller.abort(); else wall += 60_000;
      return result;
    });
    const operation = session.compile(); expect(await operation.result).toMatchObject({ ok: false, code: cause === 'abort' ? 'cancelled' : 'deadline' });
    await operation.quiesced; await session.close();
  });
  it.each(['symlink', 'hardlink'])('rejects input %s without trusting lstat alone', async kind => {
    const value = await setup(); const path = join(value.options.inputRoot, 'input-000.bin');
    await rename(path, join(value.root, 'original'));
    if (kind === 'symlink') await symlink(join(value.root, 'original'), path);
    else await link(join(value.root, 'original'), path);
    await compileRejected(value, 'filesystem');
  });
});
