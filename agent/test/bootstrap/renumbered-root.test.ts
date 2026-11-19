import { expect, it, vi } from 'vitest';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sealEngineResult } from '@beetle/contracts';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
import { payload } from '../backends/docker/fixtures.js';
import { renumberRoot } from '../staging/fixtures.js';
import { fixture, digest } from './fixtures.js';

const f = fixture();
// Docker Desktop renumbers the staging root and marker inodes across restarts. The agent must
// start on the recorded namespace and run new work to completion without a fresh installation.
it('restarts on a renumbered staging root and completes a new run under the recorded namespace', async () => {
  const e = await f.setup();
  const marker = join(e.rootPath, namespaceCaps.markerName);
  const journal = await f.open(e.journalPath);
  const before = await journal.stagingNamespace.read();
  await f.close(journal);
  if (before?.state !== 'bound') throw new Error('Missing bound namespace');
  const oldRoot = await lstat(e.rootPath, { bigint: true });
  const oldMarker = await lstat(marker, { bigint: true });
  await renumberRoot(e.rootPath);
  expect((await lstat(e.rootPath, { bigint: true })).ino).not.toBe(oldRoot.ino);
  expect((await lstat(marker, { bigint: true })).ino).not.toBe(oldMarker.ino);

  const runtime = f.keep(await openAgentRuntime(e.options));
  expect(await runtime.initial).toEqual({ ready: true });
  const path = `/runner/v1/attempts/${e.offer.attemptId}`;
  const accepted = await runtime.server.inject({ method: 'PUT', url: path, headers: e.headers, payload: e.offer });
  expect(accepted.statusCode).toBe(202);
  await vi.waitFor(
    () => {
      expect(e.daemon.calls.filter((call) => call.path.endsWith('/start'))).toHaveLength(1);
    },
    { timeout: 5000 },
  );
  const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal: _seal, ...body } = original;
  void _seal;
  const key = {
    attemptId: e.offer.attemptId,
    organizationId: e.offer.organizationId,
    workspaceId: e.offer.workspaceId,
    generation: 1,
  };
  const sealed = sealEngineResult(
    {
      ...body,
      ...key,
      artifacts: [],
      thresholds: [],
      requiredAssertions: { required: 1, passed: 1, failed: 0, unknown: 0 },
    },
    new Date().toISOString(),
    digest,
  );
  if (!sealed.ok) throw new Error(sealed.code);
  const event: ControlEvent = {
    version: '1.0',
    ...key,
    seq: 1,
    phase: 'seal',
    kind: 'engine.result',
    observedAt: new Date().toISOString(),
    payload: sealed.value,
  };
  await writeFile(join(e.output, 'engine-result.json'), JSON.stringify(sealed.value), { mode: 0o600 });
  await writeFile(join(e.output, 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
  e.daemon.state = payload(e.daemon.plan, 'exited');
  await vi.waitFor(
    async () => {
      const snapshot = await runtime.server.inject({ url: path, headers: e.headers });
      expect(snapshot.json()).toMatchObject({ state: 'exited', result: sealed.value });
      expect(runtime.status()).toMatchObject({ retainedActors: 0, scheduler: { outstanding: 0 } });
    },
    { timeout: 5000 },
  );
  await runtime.close();

  const reopened = await f.open(e.journalPath);
  expect(await reopened.stagingNamespace.read()).toEqual(before);
  expect(await reopened.admission({ kind: 'reservation', key })).toMatchObject({ status: 'released' });
  const task = await reopened.stagingNamespace.readTask({
    organizationId: key.organizationId,
    workspaceId: key.workspaceId,
    attemptId: key.attemptId,
    generation: 1,
  });
  expect(task).toMatchObject({ state: 'prepared', intent: { namespaceIdentity: before.anchor.namespaceIdentity } });
  expect(e.daemon.calls.filter((call) => call.path.includes('/create?'))).toHaveLength(1);
});

it('restarts on a renumbered root with a retained attempt from the previous start without touching its folder', async () => {
  const e = await f.setup();
  const path = `/runner/v1/attempts/${e.offer.attemptId}`;
  const first = f.keep(await openAgentRuntime(e.options));
  expect(await first.initial).toEqual({ ready: true });
  expect(
    (await first.server.inject({ method: 'PUT', url: path, headers: e.headers, payload: e.offer })).statusCode,
  ).toBe(202);
  await vi.waitFor(
    () => {
      expect(e.daemon.calls.filter((call) => call.path.endsWith('/start'))).toHaveLength(1);
    },
    { timeout: 5000 },
  );
  await first.close();
  const journal = await f.open(e.journalPath);
  const namespace = await journal.stagingNamespace.read();
  await f.close(journal);
  const files = (await readdir(e.rootPath, { recursive: true })).map(String).sort();
  await renumberRoot(e.rootPath);
  const second = f.keep(await openAgentRuntime(e.options));
  expect(await second.initial).toEqual({ ready: true });
  const snapshot = await second.server.inject({ url: path, headers: e.headers });
  expect(snapshot.statusCode).toBe(200);
  expect(snapshot.json()).toMatchObject({ attemptId: e.offer.attemptId, generation: 1 });
  await vi.waitFor(
    () => {
      expect(second.status()).toMatchObject({
        ready: true,
        retainedActors: 0,
        scheduler: { outstanding: 0, lastError: null },
      });
    },
    { timeout: 5000 },
  );
  await second.close();
  expect((await readdir(e.rootPath, { recursive: true })).map(String).sort()).toEqual(files);
  expect(e.daemon.calls.filter((call) => call.path.endsWith('/start'))).toHaveLength(1);
  const reopened = await f.open(e.journalPath);
  expect(await reopened.stagingNamespace.read()).toEqual(namespace);
});
