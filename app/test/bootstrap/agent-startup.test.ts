import {initializeBackendRecovery} from '../../src/bootstrap/recovery-control/index.js';
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Capabilities } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { loadBackendConfiguration } from '../../src/bootstrap/configuration.js';
import { settingsFixture, storageFixture } from '../storage/fixture.js';
import { listenAgent, closeAgent, writeAgentFixture } from './agent-fixture.js';
const apps: Application[] = []; const agents: (() => Promise<void>)[] = [];
afterEach(async () => {
  // Stop owned synthetic peers too if a failed test left an unfinished reply.
  await Promise.all(agents.splice(0).map(close => close()));
  await Promise.allSettled(apps.splice(0).map(app => app.close()));
});
const fixture = storageFixture();
const externalOrigin = 'http://localhost:4310';
let installationSequence = 0;
async function setup(stalled = false, mutateInputPath = false) {
  const installation = settingsFixture().chain.installation;
  installation.values.supportedProfiles = ['standard'];
  const dataRoot = join(await realpath(fixture.root()), `installation-${++installationSequence}`);
  await mkdir(dataRoot, {mode: 0o700});
  initializeBackendRecovery(join(dataRoot, 'recovery-control.sqlite'), installation.id);
  await writeFile(join(dataRoot, 'installation.json'), JSON.stringify(installation), { mode: 0o600 });
  const template = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
  const requests: string[] = []; let requested!: () => void;
  const reached = new Promise<void>(resolve => { requested = resolve; });
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    expect(request.headers.authorization).toBe(`Bearer ${connection.credential}`);
    expect(request.headers.origin).toBeUndefined(); expect(request.headers.cookie).toBeUndefined();
    requested();
    if (stalled) { response.writeHead(200, { 'content-type': 'application/json' }); response.flushHeaders(); return; }
    const now = Date.now(); const frame = structuredClone(template);
    const profile = connection.configuration.profiles[0]!;
    frame.engines[0]!.imageDigest = profile.engine.imageDigest;
    frame.engines[0]!.installedIdentity = profile.installedIdentity;
    frame.observation.installationId = installation.id;
    frame.observation.sampleStartedAtMs = now; frame.observation.observedAtMs = now;
    frame.observation.guards.observedAtMs = now; frame.observation.expiresAtMs = now + 2000;
    expect(validate('Capabilities', frame).ok).toBe(true);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(frame));
  });
  const origin = await listenAgent(server); agents.push(() => closeAgent(server));
  const connection = await writeAgentFixture(dataRoot, installation, origin);
  const options = await loadBackendConfiguration({ BEETLE_LOCAL_ACCESS: 'paired', BEETLE_CONFIG_FILE: join(dataRoot, 'installation.json'),
    BEETLE_AGENT_CONFIG_FILE: connection.path, BEETLE_DATA_DIR: dataRoot, BEETLE_EXTERNAL_ORIGIN: externalOrigin }, fixture.workerUrl());
  const alternate = join(dataRoot, 'alternate-installation');
  if (mutateInputPath) await mkdir(alternate, { mode: 0o700 });
  const mutable = { ...options.application };
  const opening = openApplication(mutable);
  if (mutateInputPath) mutable.inputsDirectory = join(alternate, 'inputs');
  const app = await opening; apps.push(app);
  return { app, requests, reached, dataRoot, alternate };
}
async function pair(app: Application) {
  const response = await app.server.inject({ method: 'POST', url: '/api/v2/auth/pair',
    headers: { host: 'localhost:4310', origin: externalOrigin, 'x-beetle-pair': '1' }, payload: { bootstrapToken: app.bootstrapToken } });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies[0]!;
  return { host: 'localhost:4310', origin: externalOrigin, cookie: `${cookie.name}=${cookie.value}`, 'x-beetle-csrf': response.json().csrfToken as string };
}
it('loads private files, authenticates real HTTP capabilities and publishes actual backend-disk ceilings into SQLite', async () => {
  const { app, requests } = await setup(); const headers = await pair(app);
  for (let turn = 0; turn < 200; turn++) {
    const state = app.runtimeState(); if (state !== 'disabled' && state.status === 'published') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(app.runtimeState()).toMatchObject({ status: 'published', reason: null });
  const settings = await app.server.inject({ url: '/api/v2/settings', headers });
  expect(settings.statusCode).toBe(200);
  expect(requests.length).toBeGreaterThan(0); expect(requests.every(path => path === '/runner/v1/capabilities')).toBe(true);
  const closing = app.close(); expect(app.close()).toBe(closing); await closing;
  const count = requests.length; await new Promise(resolve => setTimeout(resolve, 275));
  expect(requests).toHaveLength(count); expect(app.runtimeState()).toMatchObject({ status: 'closed' });
});
it('server.close aborts and drains a real stalled agent request before closing metadata', async () => {
  const { app, reached, requests } = await setup(true); await reached;
  await app.server.close(); expect(app.runtimeState()).toMatchObject({ status: 'closed' });
  const count = requests.length; await new Promise(resolve => setTimeout(resolve, 275)); expect(requests).toHaveLength(count);
});

it('captures the input directory before awaiting metadata so caller mutation cannot change storage roots', async () => {
  const { app, dataRoot, alternate } = await setup(false, true);
  expect((await stat(join(dataRoot, 'inputs', 'staging'))).isDirectory()).toBe(true);
  await expect(stat(join(alternate, 'inputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  await app.close();
});
