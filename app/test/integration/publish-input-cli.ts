import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { openMetadata } from '../../src/adapters/outbound/sqlite/index.js';
import { openLocalInputBytes } from '../../src/adapters/outbound/files/inputs/index.js';
import { createInputService } from '../../src/application/inputs/index.js';
import { prepareNamespaceCommand } from '../../src/application/namespaces/index.js';
import type { InputControl, InputRecord } from '../../src/ports/inputs.js';
import { settingsFixture } from '../domain/fixtures.js';

interface Descriptor { root: string; scope: WorkspaceScope; id: string; sha256: string; data: string }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const assert = (condition: boolean): void => { if (!condition) throw new Error('publication_bridge'); };

/** Test-owned subprocess: real application publication, no Agent implementation import.
 * The caller owns the descriptor/temp root and checks output independently.
 */
async function publish(descriptor: Descriptor, workerFile: string): Promise<InputRecord> {
  assert(validateApi('WorkspaceScope', descriptor.scope).ok && validateApi('Uuid', descriptor.id).ok);
  const data = Buffer.from(descriptor.data, 'base64'); assert(data.byteLength <= 65_536 && digest(data) === descriptor.sha256);
  const base = join(descriptor.root, 'publisher');
  const stagingRoot = join(base, 'staging'); const publishedRoot = join(base, 'published');
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 }); await mkdir(publishedRoot, { mode: 0o700 });
  const installation = settingsFixture().chain.installation;
  installation.values.pool.storageBytes = 64 * 1024 * 1024;
  const options = { path: join(base, 'metadata.sqlite'), workerUrl: pathToFileURL(workerFile), installation, runtime: null };
  const bytes = await openLocalInputBytes({ stagingRoot, publishedRoot });
  const metadata = await openMetadata(options);
  const inputs = createInputService({ store: metadata.inputs, bytes, digest });
  let published: InputRecord;
  try {
    await metadata.namespaces.execute(prepareNamespaceCommand({ kind: 'createOrganization', id: descriptor.scope.organizationId,
      request: { scope: { kind: 'installation' }, requestId: randomUUID(), name: 'Synthetic organisation', slug: 'synthetic' } }, digest));
    await metadata.namespaces.execute(prepareNamespaceCommand({ kind: 'createWorkspace', id: descriptor.scope.workspaceId,
      rootFolderId: randomUUID(), request: { scope: { kind: 'organization', organizationId: descriptor.scope.organizationId },
        requestId: randomUUID(), name: 'Synthetic workspace' } }, digest));
    const creation: InputControl = { kind: 'createInput', id: descriptor.id, request: { scope: descriptor.scope,
      requestId: randomUUID(), name: 'Synthetic dataset', bytes: data.byteLength, sha256: descriptor.sha256 } };
    const original = await inputs.control(creation); assert('state' in original && original.state === 'staging');
    const key = { scope: descriptor.scope, id: descriptor.id };
    let current = await inputs.get(key);
    // Deliberately split a UTF8 code point; publication must preserve binary bytes.
    for (let offset = 0; offset < data.byteLength; offset += 3) {
      current = await inputs.append(key, offset, async () => data.subarray(offset, Math.min(offset + 3, data.byteLength)));
    }
    const receipt = await inputs.control({ kind: 'sealInput', id: key.id,
      request: { scope: key.scope, requestId: randomUUID(), expectedVersion: current.version } });
    assert('operation' in receipt && receipt.operation === 'seal');
    published = await inputs.get(key); assert(published.state === 'published' && published.offset === data.byteLength);
    const hash = createHash('sha256'); let received = 0;
    await inputs.read(key, undefined, { write: async chunk => {
      assert(chunk.byteLength <= 65_536); received += chunk.byteLength; hash.update(chunk);
    } });
    assert(received === data.byteLength && hash.digest('hex') === descriptor.sha256);
    const replay = await inputs.control({ ...creation, id: randomUUID() });
    assert(JSON.stringify(replay) === JSON.stringify(original));
    assert((await inputs.get(key)).state === 'published');
  } finally { await inputs.close(); await metadata.close(); }
  const reopened = await openMetadata(options);
  try { assert(JSON.stringify(await reopened.inputs.get({ scope: descriptor.scope, id: descriptor.id })) === JSON.stringify(published)); }
  finally { await reopened.close(); }
  return published;
}
const descriptor = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as Descriptor;
process.stdout.write(JSON.stringify(await publish(descriptor, process.argv[3]!)) + '\n');
