import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer, get } from 'node:http';
import type { Server } from 'node:http';
import type { Socket, AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, chmod, chown } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { validate } from '@beetle/contracts';
import type { EngineManifest } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { installedConfiguration } from '../../src/bootstrap/installed-config.js';

const credential = 'S'.repeat(64);
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes())); return port;
}
function request(port: number, authenticated = true): Promise<{ status: number; body: string }> {
  return new Promise((yes, no) => {
    const call = get({ host: '127.0.0.1', port, path: '/runner/v1/capabilities', agent: false,
      headers: authenticated ? { authorization: `Bearer ${credential}` } : {} }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; if (Buffer.byteLength(body) > 16_384) call.destroy(new Error('Smoke response limit')); });
      response.once('end', () => yes({ status: response.statusCode ?? 0, body }));
      response.once('error', no);
    });
    call.setTimeout(300, () => call.destroy(new Error('Smoke request timeout'))); call.once('error', no);
  });
}
function start(path: string) {
  const child = spawn(process.execPath, [resolve('agent/dist/main.js')], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', BEETLE_AGENT_CONFIG_FILE: path }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-32_768);
  });
  const exited = new Promise<number | null>((yes, no) => { child.once('exit', code => yes(code)); child.once('error', no); });
  void exited.catch(() => undefined);
  return { child, exited, output: () => output };
}
async function waitForExit(child: ChildProcess, exited: Promise<number | null>): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Agent did not drain')), 5000);
    })]);
  } catch (error) { child.kill('SIGKILL'); await exited.catch(() => undefined); throw error; }
  finally { clearTimeout(timer); }
}
async function files(root: string, port: number) {
  const user = `${process.getuid!()}:${process.getgid!()}`;
  const staging = join(root, 'staged'); const journal = join(root, 'journal'); const inputs = join(root, 'inputs');
  await Promise.all([staging, journal, inputs].map(path => mkdir(path, { mode: 0o700 })));
  const manifest = JSON.parse(await readFile('contracts/fixtures/valid/manifest.json', 'utf8')) as EngineManifest;
  const schema = createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex'));
  manifest.schemas.config = schema.schemaId;
  manifest.defaultBudget = { cpuMillis: 1000, memoryBytes: 268_435_456, pids: 64, timeoutMs: 5000, outputBytes: 65_536 };
  manifest.minimumBudget = { cpuMillis: 100, memoryBytes: 134_217_728, pids: 16, timeoutMs: 1000, outputBytes: 65_536 };
  const installation = { installationId: '00000000-0000-4000-8000-000000000010', stagingRoot: staging,
    expectedDaemonId: 'agent-smoke-daemon', agentContainer: 'agent-smoke', agentImageId: `sha256:${'c'.repeat(64)}`, user };
  const vector = { cpuMillis: 1000, memoryBytes: 268_435_456, pids: 128, outputBytes: 65_536, stagingBytes: 4_194_304 };
  const zero = { cpuMillis: 0, memoryBytes: 0, pids: 0, outputBytes: 0, stagingBytes: 0 };
  const token = join(root, 'token'); const path = join(root, 'agent.json'); await writeFile(token, credential, { mode: 0o600 });
  const configuration = { version: 1, installation, dockerSocket: join(root, 'docker.sock'),
    journalDirectory: journal, credentialFile: token, minimumFreeBytes: 0, providers: { inputRoot: inputs, secretBindings: [] },
    configuration: { pool: vector, perRun: vector, controlReserve: zero, headroom: zero, maxConcurrent: 1,
      maxTimeoutMs: 5000, observationTtlMs: 5000, requiredSensors: [] }, listen: { host: '127.0.0.1', port },
    engines: [{ manifest, configVersion: 1, manifestId: 'k6-v1', profileId: 'smoke', catalogVersion: 1,
      profile: { installationId: installation.installationId, stagingRoot: staging, user,
        imageDigest: manifest.imageDigest, effectiveImage: { imageDigest: manifest.imageDigest, environment: ['PATH=/usr/bin'], defaultRuntime: 'runc' },
        entrypoint: manifest.entrypoint, network: { profile: 'target-egress', name: 'beetle-smoke' }, tmpfsBytes: 1_048_576, maximumBudget: manifest.defaultBudget } }] };
  installedConfiguration(configuration);
  await writeFile(path, JSON.stringify(configuration), { mode: 0o600 });
  return { path, token, installation };
}
function daemon(root: string, installation: Awaited<ReturnType<typeof files>>['installation']) {
  const sockets = new Set<Socket>(); const mutations: string[] = []; const steps: string[] = [];
  const server = createServer((input, response) => {
    if (input.method !== 'GET') mutations.push(input.method ?? 'unknown');
    steps.push(input.url === '/version' ? 'version' : input.url === '/v1.47/info' ? 'info' : 'inspect');
    if (steps.length > 32) steps.shift();
    let body: unknown; let status = 200;
    if (input.url === '/version') body = { MinAPIVersion: '1.24', ApiVersion: '1.47' };
    else if (input.url === '/v1.47/info') body = { ID: installation.expectedDaemonId, OSType: 'linux', KernelVersion: '6.6.0',
      Architecture: 'arm64', NCPU: 14, MemTotal: 16 * 1024 ** 3, MemoryLimit: true, SwapLimit: true,
      CpuCfsPeriod: true, CpuCfsQuota: true, PidsLimit: true, DefaultRuntime: 'runc' };
    else if (input.url === `/v1.47/images/sha256:${'a'.repeat(64)}/json`) body = {
      Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'arm64', Config: { Env: ['PATH=/usr/bin'] } };
    else if (input.url === '/v1.47/containers/agent-smoke/json') body = { Name: '/agent-smoke', Image: installation.agentImageId,
      Config: { User: installation.user }, State: { Running: true, Paused: false, Restarting: false, Dead: false },
      Mounts: [{ Type: 'bind', Source: installation.stagingRoot, Destination: installation.stagingRoot, RW: true, Propagation: 'rprivate' }] };
    else { status = 404; body = null; }
    response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  return { server, sockets, mutations, steps, path: join(root, 'docker.sock') };
}
async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()));
}
async function waitReady(port: number, child: ReturnType<typeof start>, steps: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && child.child.exitCode === null && child.child.signalCode === null) {
    const response = await request(port).catch(() => null);
    if (response?.status === 200) {
      assert.equal(validate('Capabilities', JSON.parse(response.body) as unknown).ok, true); return;
    }
    await pause(50);
  }
  throw new Error('Bundled agent did not become ready', { cause: new Error(
    child.output().split(credential).join('[redacted]') + ` Fixture steps: ${JSON.stringify(steps)}`) });
}
async function closeChild(child: ReturnType<typeof start> | undefined): Promise<void> {
  if (child?.child.exitCode === null && child.child.signalCode === null) {
    child.child.kill('SIGTERM'); await waitForExit(child.child, child.exited);
  }
}
async function smoke(): Promise<void> {
  if (!process.getuid?.() || !process.getgid?.()) throw new Error('Agent smoke requires a nonroot UID:GID');
  const root = await realpath(await mkdtemp('/tmp/beetle-agent-smoke-'));
  let child: ReturnType<typeof start> | undefined; let fixture: ReturnType<typeof daemon> | undefined; let listening = false;
  let cleanupFailed: boolean;
  try {
    // BSD directory group inheritance can differ from the process primary GID.
    await chown(root, process.getuid!(), process.getgid!());
    const port = await freePort(); const config = await files(root, port); const owned = daemon(root, config.installation); fixture = owned;
    await new Promise<void>((yes, no) => { owned.server.once('error', no); owned.server.listen(owned.path, yes); }); listening = true;
    child = start(config.path); await waitReady(port, child, owned.steps); assert.equal((await request(port, false)).status, 401);
    child.child.kill('SIGTERM'); assert.equal(await waitForExit(child.child, child.exited), 0);
    assert.equal(child.output().includes(credential), false); assert.equal(fixture.mutations.length, 0);
    await chmod(config.token, 0o644); child = start(config.path);
    assert.equal(await waitForExit(child.child, child.exited), 1);
    assert.equal(child.output().includes(credential), false);
    assert.equal(child.output().includes('Beetle Lab agent startup failed.'), true);
    process.stdout.write('Bundled agent smoke passed: private config/Unix transport/authenticated capabilities/SIGTERM, invalid credential rejected; daemon is a fixture.\n');
  } finally {
    const cleanup = await Promise.allSettled([closeChild(child), ...(listening && fixture ? [closeServer(fixture.server, fixture.sockets)] : [])]);
    const removed = await Promise.allSettled([rm(root, { recursive: true, force: true })]);
    cleanupFailed = [...cleanup, ...removed].some(result => result.status === 'rejected');
  }
  if (cleanupFailed) throw new Error('Agent smoke cleanup failed');
}
await smoke();
