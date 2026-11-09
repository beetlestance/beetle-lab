import { offlineAgentFixture } from './agent-fixture.js';
import { afterEach, expect, it } from 'vitest';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserSession } from '@beetle/contracts/api';
import type { InputRecord } from '../../src/ports/inputs.js';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { loadBackendConfiguration } from '../../src/bootstrap/configuration.js';
import { openInputRuntime } from '../../src/bootstrap/input-runtime.js';
import { storageFixture, seed, scope, requestId, digest, uuid } from '../storage/fixture.js';
import { inputCommand, inputOptions, transition } from '../storage/inputs-fixture.js';

const fixture = storageFixture();
const applications = new Set<Application>();
const agentCloses: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all([...applications].map(app => app.close())); applications.clear();
  await Promise.all(agentCloses.splice(0).map(close => close()));
});
const origin = 'http://127.0.0.1:43127';
const base = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/inputs`;
async function configuration() {
  const root = await realpath(fixture.root());
  const directory = join(root, `installation-${requestId()}`); await mkdir(directory, { mode: 0o700 });
  const config = join(directory, 'installation.json');
  await writeFile(config, JSON.stringify(inputOptions().installation), { mode: 0o600 });
  const agent = await offlineAgentFixture(directory, inputOptions().installation); agentCloses.push(agent.close);
  return loadBackendConfiguration({ BEETLE_AGENT_CONFIG_FILE: agent.path, BEETLE_CONFIG_FILE: config, BEETLE_DATA_DIR: directory,
    BEETLE_EXTERNAL_ORIGIN: origin }, fixture.workerUrl());
}
async function start(config: Awaited<ReturnType<typeof configuration>>) {
  const app = await openApplication(config.application); applications.add(app);
  const paired = await app.server.inject({ method: 'POST', url: '/api/v2/auth/pair', headers: {
    host: '127.0.0.1:43127', origin, 'x-beetle-pair': '1' }, payload: { bootstrapToken: app.bootstrapToken } });
  expect(paired.statusCode).toBe(200);
  const headers = { host: '127.0.0.1:43127', origin, cookie: String(paired.headers['set-cookie']).split(';')[0]!,
    'x-beetle-csrf': paired.json<BrowserSession>().csrfToken };
  return { app, headers };
}
async function stop(app: Application) { await app.close(); applications.delete(app); }
async function seedInstallation(config: Awaited<ReturnType<typeof configuration>>) {
  const metadata = await fixture.open(config.application.metadata.path, config.application.metadata);
  await seed(metadata); return metadata;
}

it('normal configuration composes paired byte routes, preserves published bytes across restart and invalidates sessions', async () => {
  const config = await configuration(); const metadata = await seedInstallation(config); await fixture.close(metadata);
  expect(config.application.inputsDirectory).toBe(join(config.application.metadata.path, '..', 'inputs'));
  let { app, headers } = await start(config); const previousHeaders = headers;
  const content = Buffer.from('synthetic π\n');
  const created = await app.server.inject({ method: 'POST', url: base, headers,
    payload: { scope, requestId: requestId(), name: 'input', sha256: digest(content.toString()), bytes: content.length } });
  expect(created.statusCode).toBe(201); const record = created.json<InputRecord>(); const url = `${base}/${record.id}`;
  const uploaded = await app.server.inject({ method: 'PUT', url: `${url}/chunks?offset=0`,
    headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: content });
  expect(uploaded.statusCode).toBe(200);
  const seal = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers,
    payload: { scope, requestId: requestId(), expectedVersion: uploaded.json<InputRecord>().version } });
  expect(seal.statusCode).toBe(202);
  expect((await app.server.inject({ url, headers })).json()).toMatchObject({ state: 'published' });
  const closeA = app.close(); expect(app.close()).toBe(closeA); await closeA; applications.delete(app);
  ({ app, headers } = await start(config));
  expect((await app.server.inject({ url, headers: previousHeaders })).statusCode).toBe(401);
  const read = await app.server.inject({ url: `${url}/content`, headers });
  expect(read.statusCode).toBe(200); expect(read.rawPayload).toEqual(content);
  expect(read.headers['transfer-encoding']).toBe('chunked'); expect(read.headers).not.toHaveProperty('content-length');
  expect(app.inputRecoveryState()).not.toBe('failed'); await stop(app); expect(app.inputRecoveryState()).toBe('closed');
});

it('startup maintenance recovers a durable pending publication without a new public seal', async () => {
  const config = await configuration(); const metadata = await seedInstallation(config);
  const record = await metadata.inputs.control(inputCommand({ kind: 'createInput', id: uuid(990), request: {
    scope, requestId: requestId(), name: 'pending empty input', sha256: digest(''), bytes: 0 } })) as InputRecord;
  await metadata.inputs.control(transition(record, 'sealInput'));
  expect(await metadata.inputs.get({ scope, id: record.id })).toMatchObject({ state: 'publishing' });
  await fixture.close(metadata);
  const { app, headers } = await start(config); const url = `${base}/${record.id}`;
  await expect.poll(async () => (await app.server.inject({ url, headers })).json<InputRecord>().state).toBe('published');
  const response = await app.server.inject({ url: `${url}/content`, headers });
  expect(response.statusCode).toBe(200); expect(response.headers['content-length']).toBe('0'); expect(response.body).toBe('');
  await app.server.close(); expect(app.inputRecoveryState()).toBe('closed');
  await stop(app);
});

it('failed root initialization leaves metadata available for a corrected startup', async () => {
  const config = await configuration(); const path = config.application.inputsDirectory!;
  await writeFile(path, 'preserved invalid root', { mode: 0o600 });
  await expect(openApplication(config.application)).rejects.toMatchObject({ name: 'InputDirectoryError' });
  // Reopening the same worker-backed database proves the failed startup released it.
  const metadata = await fixture.open(config.application.metadata.path, config.application.metadata);
  await seed(metadata); await fixture.close(metadata);
});

it('runtime shutdown fences intake and retains a held maintenance original without closing caller metadata', async () => {
  const config = await configuration(); const metadata = await seedInstallation(config);
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const runtime = await openInputRuntime(config.application.inputsDirectory!, { ...metadata.inputs,
    recovery: async query => { entered(); await held; return metadata.inputs.recovery(query); } });
  let closing: Promise<void> | undefined;
  try {
    await started; let done = false;
    closing = runtime.close(); expect(runtime.close()).toBe(closing);
    void closing.then(() => { done = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(done).toBe(false);
    await expect(runtime.inputs.get({ scope, id: uuid(990) })).rejects.toMatchObject({ code: 'closed' });
    release(); await closing; expect(runtime.recoveryState()).toBe('closed');
    expect((await metadata.inputs.list({ scope, limit: 10 })).items).toEqual([]);
  } finally { release(); await (closing ?? runtime.close()); }
});

it('failed maintenance cannot finish shutdown before a separate input original drains', async () => {
  const config = await configuration(); const metadata = await seedInstallation(config);
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const runtime = await openInputRuntime(config.application.inputsDirectory!, { ...metadata.inputs,
    recovery: async () => { throw new Error('synthetic transient recovery failure'); },
    get: async key => { entered(); await held; return metadata.inputs.get(key); } });
  let closing: Promise<unknown> | undefined;
  try {
    await expect.poll(() => runtime.recoveryState()).toBe('failed');
    const read = runtime.inputs.get({ scope, id: uuid(990) }).catch(() => undefined); await started;
    let done = false; closing = runtime.close().catch(error => { done = true; return error as unknown; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(done).toBe(false);
    release(); await read; expect(await closing).toMatchObject({ name: 'InputMaintenanceError' });
    expect((await metadata.inputs.list({ scope, limit: 10 })).items).toEqual([]);
  } finally { release(); await (closing ?? runtime.close().catch(() => undefined)); }
});
