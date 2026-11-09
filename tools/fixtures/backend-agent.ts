import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { InstallationValues } from '@beetle/contracts/api';
interface FixtureInstallation { readonly id: string; readonly values: Pick<InstallationValues, 'pool' | 'runDefaults'> }
const credential = 'synthetic_backend_agent_'.padEnd(43, 'x');
const schemaDigest = createK6ConfigSchema(text => createHash('sha256').update(text).digest('hex')).schemaDigest;

export async function writeAgentFixture(root: string, installation: FixtureInstallation, origin: string) {
  root = await realpath(root);
  const profile = { engine: { id: 'k6' as const, profileId: installation.values.runDefaults.engineProfile,
    imageDigest: `sha256:${'0'.repeat(64)}`, configVersion: 1 as const }, installedIdentity: { manifestId: 'fixture-manifest',
    profileId: 'fixture-installed', catalogVersion: 1, manifestDigest: '1'.repeat(64), profileDigest: '2'.repeat(64), schemaDigest },
    requiredCapabilities: ['http'] };
  const tokenFile = join(root, 'agent-token'); const path = join(root, 'agent.json');
  const configuration = { version: 1 as const, origin, tokenFile,
    expectedInstallationId: installation.id, profiles: [profile],
    storageAllocationBytes: installation.values.pool.storageBytes * 2,
    freeSpaceReserveBytes: installation.values.pool.freeSpaceReserveBytes * 2 };
  await writeFile(tokenFile, credential, { mode: 0o600 });
  await writeFile(path, JSON.stringify(configuration), { mode: 0o600 });
  return { path, configuration, credential };
}
export async function listenAgent(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
export async function closeAgent(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
/** Explicit unavailable private agent, preserving unknown-capacity smoke assertions. */
export async function offlineAgentFixture(root: string, installation: FixtureInstallation) {
  const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
  try {
    const origin = await listenAgent(server); const config = await writeAgentFixture(root, installation, origin);
    return { ...config, close: () => closeAgent(server) };
  } catch (error) { await closeAgent(server); throw error; }
}
