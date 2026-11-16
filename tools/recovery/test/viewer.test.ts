import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, readFile, writeFile, realpath, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { storageFixture, seed, settingsFixture } from '../../../app/test/storage/fixture.js';
import { archiveFixture } from './archive-fixture.js';
import { RecoveryIO } from '../src/io.js';
import { restoreHistory } from '../src/restore.js';
import { openHistoryViewer } from '../src/viewer/index.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import header from '../../../contracts/fixtures/valid/recovery-header.json' with {type: 'json'};
const storage = storageFixture();
const operation = () => ({signal: new AbortController().signal, deadline: performance.now() + 15000});
const origin = 'http://127.0.0.1:43129';
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
it('opens real worker-backed historical HTTP with separate persistent auth, no maintenance and no writes', async () => {
  const sourcePath = storage.path(); const source = await storage.open(sourcePath); await seed(source);
  await storage.close(source); const metadataPath = await realpath(sourcePath);
  const config = join(await realpath(storage.root()), 'history-installation.json');
  await writeFile(config, JSON.stringify(settingsFixture().chain.installation), {mode: 0o600});
  const f = await archiveFixture({[header.roles.metadata]: metadataPath, [header.roles.installationConfig]: config});
  const root = join(f.root, 'history'); const limits = {maximumBytes: 8388608, maximumEntries: 1000};
  await restoreHistory({archive: f.destination, destination: root, operationId: randomUUID(), limits, operation: operation()});
  const restoredMetadata = join(root, 'data', header.roles.metadata); const before = await hash(restoredMetadata);
  const options = {root, externalOrigin: origin, metadataWorkerUrl: storage.workerUrl(), limits};
  let app = await openHistoryViewer({...options, operation: operation()});
  const headers = {host: '127.0.0.1:43129', origin, 'content-type': 'application/json', 'x-beetle-local': '1'};
  try {
    const opened = await app.server.inject({method: 'POST', url: '/api/v2/auth/local', headers, payload: {}});
    expect(opened.statusCode).toBe(200); expect(opened.json()).toMatchObject({readOnly: true, accessMode: 'automatic'});
    const setCookie = opened.headers['set-cookie']; const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(';')[0]!;
    expect(cookie).toMatch(/^beetle_history_[a-f0-9]{32}=/); const auth = {...headers, cookie, 'x-beetle-csrf': opened.json<{csrfToken: string}>().csrfToken};
    expect((await app.server.inject({url: '/api/v2/organizations?limit=100', headers: auth})).statusCode).toBe(200);
    expect((await app.server.inject({method: 'POST', url: '/api/v2/organizations', headers: auth, payload: {}})).statusCode).toBe(403);
    expect(app.runtimeState()).toBe('disabled'); expect(app.inputRecoveryState()).toBe('disabled'); expect(app.historySummaryState()).toBe('disabled');
    await app.close(); app = await openHistoryViewer({...options, operation: operation()});
    expect((await app.server.inject({url: '/api/v2/auth/session', headers: auth})).statusCode).toBe(200);
    expect((await app.server.inject({url: '/api/v2/auth/session', headers: {...headers, cookie: 'beetle_session=' + 'a'.repeat(43)}})).statusCode).toBe(401);
  } finally {await app.close();}
  expect(await hash(restoredMetadata)).toBe(before);
});
it('refuses a read-only metadata option without the historical composition', async () => {
  await expect(openApplication({externalOrigin: origin, localAccess: 'automatic', metadata: {path: storage.path(), workerUrl: storage.workerUrl(),
    installation: settingsFixture().chain.installation, runtime: null, readOnly: true}})).rejects.toThrow('Historical composition required');
});

it('rejects metadata path replacement during final drainage before the serving worker opens', async () => {
  const sourcePath = storage.path(); const source = await storage.open(sourcePath); await seed(source); await storage.close(source);
  const config = join(await realpath(storage.root()), 'replacement-installation.json');
  await writeFile(config, JSON.stringify(settingsFixture().chain.installation), {mode: 0o600});
  const f = await archiveFixture({[header.roles.metadata]: await realpath(sourcePath), [header.roles.installationConfig]: config});
  const root = join(f.root, 'history'); const limits = {maximumBytes: 8388608, maximumEntries: 1000};
  await restoreHistory({archive: f.destination, destination: root, operationId: randomUUID(), limits, operation: operation()});
  const metadata = join(root, 'data', header.roles.metadata); const original = RecoveryIO.prototype.closeAll;
  vi.spyOn(RecoveryIO.prototype, 'closeAll').mockImplementationOnce(async function(this: RecoveryIO) {
    await original.call(this); await chmod(dirname(metadata), 0o700); await rename(metadata, join(f.root, 'old-metadata.sqlite'));
    await copyFile(join(f.destination, header.roles.metadata), metadata); await chmod(metadata, 0o400); await chmod(dirname(metadata), 0o500);
  });
  try {await expect(openHistoryViewer({root, externalOrigin: origin, metadataWorkerUrl: storage.workerUrl(), limits, operation: operation()})).rejects.toThrow('unavailable');}
  finally {vi.restoreAllMocks();}
});
