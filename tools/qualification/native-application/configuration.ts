import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';

export function argumentsFor(values: string[]) {
  const [agentImage, engineImage, status = '200', context = 'default'] = values;
  if (!agentImage || !engineImage || !['200', '500'].includes(status) || values.length > 4 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context) ||
    values.some(value => value.length > 256 || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(value))) {
    throw new Error('Usage: smoke-app.ts AGENT_IMAGE ENGINE_IMAGE [200|500] [LOCAL_CONTEXT]');
  }
  return { agentImage, engineImage, status: Number(status), context };
}
export function agentOrigin(published: string): string {
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(published);
  assert(match && Number(match[1]) <= 65535, 'Expected exactly one loopback agent publication');
  return `http://127.0.0.1:${match[1]}`;
}
export async function backendConfiguration(f: Fixture, origin: string, externalOrigin: string) {
  const dataRoot = join(f.root, 'backend'); await mkdir(dataRoot, { mode: 0o700 });
  const record = JSON.parse(await readFile(new URL('../../../contracts/fixtures/api/valid/installation-settings.json', import.meta.url), 'utf8'));
  delete record.effective;
  Object.assign(record, { id: f.id });
  Object.assign(record.values, {
    pool: { cpuMillis: 2000, memoryBytes: 1073741824, pids: 256, outputBytes: 67108864,
      concurrency: 1, storageBytes: 268435456, freeSpaceReserveBytes: 16777216 },
    perRunCeilings: f.budget, supportedProfiles: ['native-k6'],
    runDefaults: { engineProfile: 'native-k6', budget: f.budget },
  });
  const installationFile = join(dataRoot, 'installation.json'); const connectionFile = join(dataRoot, 'agent.json');
  await writeFile(installationFile, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  await writeFile(connectionFile, JSON.stringify({ version: 1, origin, tokenFile: f.tokenPath,
    expectedInstallationId: f.id, profiles: [{ engine: { ...f.offer.engine, profileId: 'native-k6' },
      installedIdentity: f.offer.installedIdentity, requiredCapabilities: [] }],
    storageAllocationBytes: 268435456, freeSpaceReserveBytes: 16777216 }), { mode: 0o600, flag: 'wx' });
  const workerFile = resolve(process.env.BEETLE_METADATA_WORKER_FILE ?? 'app/dist/worker.js');
  return loadBackendConfiguration({ BEETLE_CONFIG_FILE: installationFile, BEETLE_AGENT_CONFIG_FILE: connectionFile,
    BEETLE_DATA_DIR: dataRoot, BEETLE_EXTERNAL_ORIGIN: externalOrigin,
    BEETLE_LISTEN_HOST: '127.0.0.1', BEETLE_LISTEN_PORT: new URL(externalOrigin).port }, pathToFileURL(workerFile));
}
