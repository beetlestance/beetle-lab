import { afterAll, afterEach, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'tsup';
import type { Folder, Organization, Workspace, WorkspaceScope } from '@beetle/contracts/api';
import { openMetadata } from '../../src/adapters/outbound/sqlite/index.js';
import type { Metadata, MetadataOptions, RuntimeObservation } from '../../src/adapters/outbound/sqlite/index.js';
import type { RuntimeCeilings } from '../../src/domain/settings/index.js';
import { prepareNamespaceCommand } from '../../src/application/namespaces/index.js';
import { prepareSettingsCommand } from '../../src/application/settings/index.js';
import type { NamespaceOperation } from '../../src/ports/namespaces.js';
import type { SettingsCommand, SettingsRequest } from '../../src/ports/settings.js';
import { settingsFixture, uuid } from '../domain/fixtures.js';
export { uuid, settingsFixture } from '../domain/fixtures.js';
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
let request = 100000;
export const requestId = (): string => uuid(++request);
export function observation(ceilings: RuntimeCeilings = settingsFixture().runtime, observedAtMs = Date.now(), ttlMs = 5000): RuntimeObservation {
  return { journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings, observedAtMs, expiresAtMs: observedAtMs + ttlMs };
}
export const scope: WorkspaceScope = { kind: 'workspace', organizationId: uuid(1), workspaceId: uuid(2) };
export function command<T extends NamespaceOperation>(operation: T): T & { intentDigest: string } {
  return prepareNamespaceCommand(operation, digest) as T & { intentDigest: string };
}
export function settingsCommand<T extends SettingsRequest>(id: string, request: T): SettingsCommand & { request: T } {
  return prepareSettingsCommand({ id, request, digest }) as SettingsCommand & { request: T };
}
export function storageFixture() {
  let root = '';
  let workerUrl: URL;
  let sequence = 0;
  const handles = new Set<Metadata>();
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'beetle-metadata-'));
    const outDir = join(root, 'worker');
    await build({ entry: ['app/src/adapters/outbound/sqlite/worker.ts'], outDir, format: ['esm'],
      platform: 'node', target: 'node24', bundle: true, noExternal: [/.*/], shims: true,
      removeNodeProtocol: false, splitting: false, silent: true });
    workerUrl = pathToFileURL(join(outDir, 'worker.js'));
  }, 20000);
  afterEach(async () => { await Promise.all([...handles].map(handle => handle.abort())); handles.clear(); });
  afterAll(async () => { await rm(root, { force: true, recursive: true }); });
  const path = () => join(root, `metadata-${++sequence}.sqlite`);
  async function open(dbPath = path(), options: Partial<MetadataOptions> = {}): Promise<Metadata> {
    const fixture = settingsFixture();
    const handle = await openMetadata({ path: dbPath, workerUrl, installation: fixture.chain.installation,
      runtime: observation(fixture.runtime, Date.now(), options.runtimeTtlMs ?? 5000), ...options });
    handles.add(handle); return handle;
  }
  async function close(handle: Metadata): Promise<void> { await handle.close(); handles.delete(handle); }
  return { open, close, path, root: () => root, workerUrl: () => workerUrl, handles };
}
export async function seed(metadata: Metadata, org = 1, workspace = 2, root = 3) {
  const organization = await metadata.namespaces.execute(command({ kind: 'createOrganization', id: uuid(org),
    request: { requestId: requestId(), scope: { kind: 'installation' }, name: `Org ${org}`, slug: `org-${org}` } })) as Organization;
  const value = await metadata.namespaces.execute(command({ kind: 'createWorkspace', id: uuid(workspace), rootFolderId: uuid(root),
    request: { requestId: requestId(), scope: { kind: 'organization', organizationId: organization.id }, name: 'Project' } })) as Workspace;
  return { organization, workspace: value };
}
export async function createFolder(metadata: Metadata, id: number, parent = uuid(3), owner = scope, name = `Folder ${id}`) {
  return await metadata.namespaces.execute(command({ kind: 'createFolder', id: uuid(id),
    request: { requestId: requestId(), scope: owner, name, parentFolderId: parent } })) as Folder;
}
