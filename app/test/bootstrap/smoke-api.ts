import { offlineAgentFixture } from './agent-fixture.js';
import { initializeBackendRecovery } from '../../src/bootstrap/recovery-control/index.js';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { settingsFixture } from '../domain/fixtures.js';
import { authorSuites } from './suite-authoring.js';
import { authorInputs } from './input-authoring.js';
type Child = ChildProcessByStdio<null, Readable, Readable>;
type Exit = { code: number | null; signal: NodeJS.Signals | null };
async function ownedPort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No owned port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
function startup(child: Child, termination: Promise<Exit>): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderrBytes = 0;
    child.stdout.on('data', (data: Buffer) => {
      if (Buffer.byteLength(stdout) + data.byteLength > 4096) { child.kill('SIGKILL'); reject(new Error('Startup stdout limit')); return; }
      stdout += data.toString('utf8');
      if (stdout.includes('local startup token:')) {reject(new Error('Automatic startup exposed a pairing token')); return;}
      if (stdout.includes('Beetle Lab local access ready.')) resolve();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderrBytes += data.byteLength;
      if (stderrBytes > 8192) { child.kill('SIGKILL'); reject(new Error('Startup stderr limit')); }
    });
    child.once('error', reject);
    void termination.then(() => reject(new Error('Backend exited before startup')));
  });
}
async function exchange(origin: string): Promise<void> {
  const headers = { origin, 'content-type': 'application/json', 'x-beetle-local': '1' };
  const pair = await fetch(origin + '/api/v2/auth/local', { method: 'POST', headers,
    body: '{}', signal: AbortSignal.timeout(3000) });
  if (pair.status !== 200) throw new Error('Automatic local access status');
  const view = await pair.json() as { csrfToken: string };
  const cookie = pair.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No session cookie');
  const page = await fetch(origin + '/api/v2/organizations?limit=100', { headers: { cookie }, signal: AbortSignal.timeout(3000) });
  if (page.status !== 200) throw new Error('Namespace status');
  await page.body?.cancel();
  await authorSuites(origin, cookie, view.csrfToken);
  await authorInputs(origin, cookie, view.csrfToken);
  const logout = await fetch(origin + '/api/v2/auth/logout', { method: 'POST',
    headers: { ...headers, cookie, 'x-beetle-csrf': view.csrfToken }, body: '{}', signal: AbortSignal.timeout(3000) });
  if (logout.status !== 200) throw new Error('Logout status');
  await logout.body?.cancel();
}
async function run(root: string, port: number): Promise<void> {
  await mkdir(join(root, 'data'), { mode: 0o700 });
  const installation = settingsFixture().chain.installation;
  // The domain fixture's 10KB pool cannot hold one input's 64KB metadata charge.
  installation.values.pool.storageBytes = 2_000_000;
  initializeBackendRecovery(join(root, 'data', 'recovery-control.sqlite'), installation.id);
  await writeFile(join(root, 'installation.json'), JSON.stringify(installation), { mode: 0o600 });
  const origin = `http://127.0.0.1:${port}`;
  const agent = await offlineAgentFixture(root, installation);
  const child = spawn(process.execPath, ['app/dist/main.js'], { cwd: process.cwd(), env: {
    BEETLE_AGENT_CONFIG_FILE: agent.path, PATH: process.env.PATH ?? '', BEETLE_CONFIG_FILE: join(root, 'installation.json'),
    BEETLE_DATA_DIR: join(root, 'data'), BEETLE_EXTERNAL_ORIGIN: origin, BEETLE_LISTEN_PORT: String(port),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  const termination = new Promise<Exit>(resolve => child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); }));
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 30_000);
  try {
    await startup(child, termination); await exchange(origin);
    child.kill('SIGTERM'); const exit = await termination;
    if (exit.code !== 0 || exit.signal !== null) throw new Error('Backend shutdown failed');
    process.stdout.write('Backend smoke passed: automatic local access without token output, namespaces, full-size suites, unavailable run enqueue/scoped reads, chunked input publication/read/delete, logout, clean SIGTERM.\n');
  } finally {
    clearTimeout(timer);
    if (!closed) { child.kill('SIGKILL'); await termination; }
    await agent.close();
  }
}
const port = await ownedPort();
const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-api-smoke-')));
try { await run(root, port); }
finally { await rm(root, { recursive: true, force: true }); }
