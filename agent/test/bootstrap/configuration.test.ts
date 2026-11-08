import { expect, it } from 'vitest';
import { chmod, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAgentConfiguration } from '../../src/bootstrap/index.js';
import { installedConfiguration } from '../../src/bootstrap/installed-config.js';
import { fixture, credential } from './fixtures.js';
import { configurationFiles } from './configuration-fixtures.js';

const f = fixture();
it('loads actual private config, mounted credential, scoped providers and shipped schema pins', async () => {
  const e = await f.setup(); const files = await configurationFiles(e.rootPath, e.options);
  const loaded = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: files.path }, f.workerUrl());
  try {
    expect(loaded.runtime.credential).toBe(credential); expect(loaded.listen).toEqual({ host: '127.0.0.1', port: 4312 });
    expect(loaded.runtime.journal.path).toBe(join(files.journal, 'journal.sqlite'));
    const engine = loaded.runtime.catalog.engines[0]!;
    expect(engine.validation.schemaDigest).toBe(engine.configSchema.schemaDigest);
    expect(engine.configSchema.validate({ note: 'synthetic invalid k6 config' })).toBe(false);
    expect(engine.profile.imageDigest).toBe(e.options.catalog.engines[0]!.profile.imageDigest);
    const first = loaded.close(); expect(loaded.close()).toBe(first); await first;
  } finally { await loaded.close(); }
});

it('rejects unknown engines and schema/manifest mismatches without loading arbitrary code', async () => {
  const e = await f.setup(); const files = await configurationFiles(e.rootPath, e.options);
  expect(installedConfiguration(files.value).catalog.engines).toHaveLength(1);
  expect(() => installedConfiguration({ ...files.value, engines: [{ ...files.value.engines[0]!, configVersion: 2 }] })).toThrow();
  const original = files.value.engines[0]!;
  expect(() => installedConfiguration({ ...files.value, engines: [{ ...original, manifest: { ...original.manifest, engineId: 'unknown' } }] })).toThrow();
  expect(() => installedConfiguration({ ...files.value, engines: [{ ...original, manifest: { ...original.manifest,
    schemas: { ...original.manifest.schemas, config: 'https://example.invalid/schema' } } }] })).toThrow();
});

it.each(['root-key', 'listener', 'path', 'version'] as const)('rejects invalid installation envelope: %s', async cause => {
  const e = await f.setup(); const files = await configurationFiles(e.rootPath, e.options);
  expect(installedConfiguration(files.value).catalog.engines).toHaveLength(1);
  const amendments = { 'root-key': { unknown: true }, listener: { listen: { host: 'example.invalid', port: 4312 } },
    path: { credentialFile: '../token' }, version: { version: 2 } };
  expect(() => installedConfiguration({ ...files.value, ...amendments[cause] })).toThrow();
});

it.each(['newline', 'oversize', 'public', 'symlink', 'directory'] as const)('rejects invalid mounted credential: %s', async cause => {
  const e = await f.setup(); const files = await configurationFiles(e.rootPath, e.options);
  if (cause === 'newline') await writeFile(files.token, credential + '\n');
  if (cause === 'oversize') await writeFile(files.token, 'R'.repeat(129));
  if (cause === 'public') await chmod(files.token, 0o644);
  if (cause === 'symlink') {
    const alias = join(e.rootPath, 'credential-alias'); await symlink(files.token, alias); files.value.credentialFile = alias; await files.save();
  }
  if (cause === 'directory') { files.value.credentialFile = files.inputs; await files.save(); }
  await expect(loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: files.path }, f.workerUrl())).rejects.toThrow('Agent installation configuration is invalid');
});

it('rejects unsafe journal storage and startup abort without creating a journal', async () => {
  const e = await f.setup(); const files = await configurationFiles(e.rootPath, e.options);
  await chmod(files.journal, 0o755);
  await expect(loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: files.path }, f.workerUrl())).rejects.toThrow();
  await chmod(files.journal, 0o700);
  await expect(loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: files.path }, f.workerUrl(), AbortSignal.abort())).rejects.toThrow();
});
