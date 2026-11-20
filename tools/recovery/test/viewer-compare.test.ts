import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { history } from '../../../app/test/retention/selection-fixture.js';
import { runIds } from '../../../app/test/storage/run-pin-fixtures.js';
import { scope, storageFixture, uuid } from '../../../app/test/storage/fixture.js';
import header from '../../../contracts/fixtures/valid/recovery-header.json' with { type: 'json' };
import { archiveFixture } from './archive-fixture.js';
import { restoreHistory } from '../src/restore.js';
import { openHistoryViewer } from '../src/viewer/index.js';

const storage = storageFixture();
const operation = () => ({ signal: new AbortController().signal, deadline: performance.now() + 15000 });
const limits = { maximumBytes: 8388608, maximumEntries: 1000 };
const origin = 'http://127.0.0.1:43131';

async function archivedRuns() {
  const fixture = history(2);
  const ids = runIds(fixture.db);
  const source = storage.path();
  fixture.db.prepare('VACUUM INTO ?').run(source);
  const config = join(await realpath(storage.root()), 'installation.json');
  await writeFile(config, JSON.stringify(fixture.settings.chain(scope).installation), { mode: 0o600 });
  fixture.db.close();
  const archive = await archiveFixture({
    [header.roles.metadata]: await realpath(source),
    [header.roles.installationConfig]: config,
  });
  const root = join(archive.root, 'history');
  await restoreHistory({
    archive: archive.destination,
    destination: root,
    operationId: randomUUID(),
    limits,
    operation: operation(),
  });
  return { ids, root };
}

it('opens the scoped comparison query and keeps write and credential checks for restored history', async () => {
  const { ids, root } = await archivedRuns();
  const metadata = join(root, 'data', header.roles.metadata);
  const digest = async () =>
    createHash('sha256')
      .update(await readFile(metadata))
      .digest('hex');
  const before = await digest();
  const viewer = await openHistoryViewer({
    root,
    externalOrigin: origin,
    metadataWorkerUrl: storage.workerUrl(),
    limits,
    operation: operation(),
  });
  const headers = { host: new URL(origin).host, origin, 'content-type': 'application/json' };
  try {
    const opened = await viewer.server.inject({
      method: 'POST',
      url: '/api/v2/auth/local',
      headers: { ...headers, 'x-beetle-local': '1' },
      payload: {},
    });
    expect(opened.statusCode).toBe(200);
    const raw = opened.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0]! : raw!).split(';')[0]!;
    const auth = { ...headers, cookie, 'x-beetle-csrf': opened.json<{ csrfToken: string }>().csrfToken };
    const workspace = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}`;
    const comparison = {
      method: 'POST' as const,
      url: workspace + '/comparisons',
      payload: { scope, runIds: ids, metric: null },
    };
    expect((await viewer.server.inject({ ...comparison, headers: { ...headers, cookie } })).statusCode).toBe(403);
    const wrongScope = { ...scope, workspaceId: uuid(9800) };
    const mismatch = await viewer.server.inject({
      ...comparison,
      headers: auth,
      payload: { ...comparison.payload, scope: wrongScope },
    });
    expect(mismatch.statusCode).toBe(403);
    const tooLarge = await viewer.server.inject({
      ...comparison,
      headers: auth,
      payload: JSON.stringify(comparison.payload).padEnd(4097, ' '),
    });
    expect(tooLarge.statusCode).toBe(413);
    const read = await viewer.server.inject({ ...comparison, headers: auth });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ scope, baselineRunId: ids[0], items: ids.map((id) => ({ run: { id } })) });
    const malformedWrite = await viewer.server.inject({
      method: 'POST',
      url: workspace + '/runs',
      headers: auth,
      payload: '{',
    });
    expect(malformedWrite.statusCode).toBe(403);
  } finally {
    await viewer.close();
  }
  expect(await digest()).toBe(before);
});
