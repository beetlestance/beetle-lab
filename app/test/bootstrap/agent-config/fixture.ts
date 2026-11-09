import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { AgentConnectionConfiguration } from '../../../src/ports/runner.js';
import type { RunProfilePin } from '../../../src/ports/runs.js';

export const installationId = '00000000-0000-4000-8000-000000000001';
export const credential = 'synthetic_W93_'.padEnd(43, 'x');
const schemaDigest = createK6ConfigSchema(text => createHash('sha256').update(text).digest('hex')).schemaDigest;
export function pin(index = 0): RunProfilePin {
  return { engine: { id: 'k6', profileId: `alias-${index}`, imageDigest: `sha256:${index.toString(16).padStart(64, '0')}`, configVersion: 1 },
    installedIdentity: { manifestId: `manifest-${index}`, profileId: `installed-${index}`, catalogVersion: 1,
      manifestDigest: '1'.repeat(64), profileDigest: '2'.repeat(64), schemaDigest }, requiredCapabilities: ['http'] };
}
export async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'w93-agent-config-'));
  await chmod(root, 0o700);
  const path = join(root, 'configuration.json'); const tokenPath = join(root, 'token');
  const value: AgentConnectionConfiguration = { version: 1, origin: 'http://agent:4312', tokenFile: tokenPath,
    expectedInstallationId: installationId, profiles: [pin()], storageAllocationBytes: 1000, freeSpaceReserveBytes: 100 };
  const write = async (input: unknown = value) => { await writeFile(path, JSON.stringify(input), { mode: 0o600 }); };
  await write(); await writeFile(tokenPath, credential, { mode: 0o600 });
  return { root, path, tokenPath, value, write, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
