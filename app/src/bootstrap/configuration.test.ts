import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { loadBackendConfiguration } from './configuration.js';
import { settingsFixture } from '../../test/domain/fixtures.js';
const roots: string[] = [];
const execute = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'beetle-configuration-')); roots.push(root);
  const data = join(root, 'data'); await mkdir(data, { mode: 0o700 });
  const config = join(root, 'installation.json'); const installation = settingsFixture().chain.installation;
  await writeFile(config, JSON.stringify(installation), { mode: 0o600 });
  const environment = { BEETLE_CONFIG_FILE: config, BEETLE_DATA_DIR: data, BEETLE_EXTERNAL_ORIGIN: 'http://localhost:4310' };
  return { root, config, data, installation, environment };
}
const worker = new URL('file:///synthetic/worker.js');
it('loads only explicit installation settings and preserves unknown runtime capacity', async () => {
  const value = await fixture();
  const loaded = await loadBackendConfiguration(value.environment, worker);
  expect(loaded.listen).toEqual({ host: '127.0.0.1', port: 4311 });
  expect(loaded.application.metadata).toEqual({ path: join(await realpath(value.data), 'metadata.sqlite'), workerUrl: worker,
    installation: value.installation, runtime: null });
  expect(loaded.application.externalOrigin).toBe('http://localhost:4310');
  expect(Object.isFrozen(loaded)).toBe(true);
});
it.each(['0', '-1', '65536', '1.5', '04311', '4311junk'])('rejects invalid listener port %s', async port => {
  const value = await fixture();
  await expect(loadBackendConfiguration({ ...value.environment, BEETLE_LISTEN_PORT: port }, worker)).rejects.toMatchObject({ code: 'listener' });
});
it('requires absolute installation paths and explicit origin instead of ambient machine guesses', async () => {
  const value = await fixture();
  for (const environment of [{ ...value.environment, BEETLE_CONFIG_FILE: 'relative.json' },
    { ...value.environment, BEETLE_DATA_DIR: '../data' }, { ...value.environment, BEETLE_EXTERNAL_ORIGIN: '' },
    { ...value.environment, BEETLE_LISTEN_HOST: 'some-network-host' }]) {
    await expect(loadBackendConfiguration(environment, worker)).rejects.toThrow('Backend startup failed');
  }
});
it('rejects unsafe file types, permissions, oversize and invalid UTF8 without raw diagnostics', async () => {
  const value = await fixture(); const target = join(value.root, 'link.json'); await symlink(value.config, target);
  await expect(loadBackendConfiguration({ ...value.environment, BEETLE_CONFIG_FILE: target }, worker)).rejects.toMatchObject({ code: 'configuration' });
  for (const bytes of [Buffer.alloc(32_769, 32), Buffer.from([0xff]), Buffer.from('PRIVATE_SENTINEL')]) {
    await writeFile(value.config, bytes);
    const error: unknown = await loadBackendConfiguration(value.environment, worker).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'configuration' }); expect(String(error)).not.toContain('PRIVATE_SENTINEL');
  }
  await writeFile(value.config, JSON.stringify(value.installation)); await chmod(value.config, 0o666);
  await expect(loadBackendConfiguration(value.environment, worker)).rejects.toMatchObject({ code: 'configuration' });
});
it('requires an installation-owned private data directory', async () => {
  const value = await fixture(); await chmod(value.data, 0o755);
  await expect(loadBackendConfiguration(value.environment, worker)).rejects.toMatchObject({ code: 'data_directory' });
});
it('rejects a FIFO without waiting for a writer, under an independent process deadline', async () => {
  const value = await fixture(); const fifo = join(value.root, 'configuration-fifo');
  await execute('mkfifo', [fifo], { timeout: 2000 });
  const source = new URL('./configuration.ts', import.meta.url).href;
  const code = `import {loadBackendConfiguration} from ${JSON.stringify(source)};
    try { await loadBackendConfiguration(JSON.parse(process.argv[1]),new URL('file:///synthetic/worker.js')); process.exitCode=2; }
    catch(error) { process.stdout.write(error.code==='configuration'?'rejected':'wrong'); }`;
  const result = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code,
    JSON.stringify({ ...value.environment, BEETLE_CONFIG_FILE: fifo })], { timeout: 5000, maxBuffer: 1024 });
  expect(result.stdout).toBe('rejected');
});
it('rejects unknown installation fields and malformed settings before opening storage', async () => {
  const value = await fixture();
  for (const input of [{ ...value.installation, secret: 'PRIVATE_SENTINEL' }, { ...value.installation, version: 2 },
    { ...value.installation, values: {} }, { ...value.installation, id: 'bad' }]) {
    await writeFile(value.config, JSON.stringify(input));
    await expect(loadBackendConfiguration(value.environment, worker)).rejects.toMatchObject({ code: 'configuration' });
  }
});
