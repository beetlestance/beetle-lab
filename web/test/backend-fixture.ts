import { initializeBackendRecovery } from '../../app/src/bootstrap/recovery-control/index.js';
import { offlineAgentFixture } from '../../tools/fixtures/backend-agent.js';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateApi } from '@beetle/contracts/api';
import template from '../../contracts/fixtures/api/valid/installation-settings.json' with { type: 'json' };

type Child = ChildProcessByStdio<null, Readable, Readable>;
interface Exit { code: number | null; signal: NodeJS.Signals | null }
async function ownedPort(): Promise<number> {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Owned port unavailable');
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return address.port;
}
function startup(child: Child, termination: Promise<Exit>): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''; let errors = 0;
    child.stdout.on('data', (data: Buffer) => {
      if (Buffer.byteLength(text) + data.length > 4096) { child.kill('SIGKILL'); reject(new Error('Startup output limit')); return; }
      text += data.toString('utf8');
      const token = /local startup token: ([A-Za-z0-9_-]{43})\n/.exec(text);
      if (token) resolve(token[1]!);
    });
    child.stderr.on('data', (data: Buffer) => {
      errors += data.length;
      if (errors > 8192) { child.kill('SIGKILL'); reject(new Error('Startup error limit')); }
    });
    child.once('error', reject);
    void termination.then(() => reject(new Error('Backend closed before startup')));
  });
}
async function installation(root: string) {
  const checked = validateApi('InstallationSettings', template);
  if (!checked.ok) throw new Error('Invalid synthetic installation');
  const values = structuredClone(checked.value.values);
  values.pool.storageBytes = 2_000_000; values.pool.freeSpaceReserveBytes = 1000;
  await mkdir(join(root, 'data'), { mode: 0o700 });
  const record = { id: randomUUID(), version: 1 as const, schemaVersion: 2 as const, scope: { kind: 'installation' as const }, values };
  await writeFile(join(root, 'installation.json'), JSON.stringify(record), { mode: 0o600 });
  initializeBackendRecovery(join(root, 'data', 'recovery-control.sqlite'), record.id); return record;
}
async function serve(root: string, work: (origin: string, token: string) => Promise<void>): Promise<void> {
  const record = await installation(root); const agent = await offlineAgentFixture(root, record); const port = await ownedPort(); const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['app/dist/main.js'], { cwd: process.cwd(), env: {
    BEETLE_LOCAL_ACCESS: 'paired', BEETLE_AGENT_CONFIG_FILE: agent.path, PATH: process.env.PATH ?? '', BEETLE_CONFIG_FILE: join(root, 'installation.json'),
    BEETLE_DATA_DIR: join(root, 'data'), BEETLE_EXTERNAL_ORIGIN: origin, BEETLE_LISTEN_PORT: String(port),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  const termination = new Promise<Exit>(resolve => child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); }));
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 30_000);
  try {
    await work(origin, await startup(child, termination));
    child.kill('SIGTERM'); const exit = await termination;
    if (exit.code !== 0 || exit.signal !== null) throw new Error('Backend shutdown failed');
  } finally {
    clearTimeout(timer);
    if (!closed) { child.kill('SIGKILL'); await termination; }
    await agent.close();
  }
}
/** Fresh private installation; no engine, target or shared database. */
export async function withBackend(work: (origin: string, token: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-input-controls-')));
  try { await serve(root, work); }
  finally { await rm(root, { recursive: true, force: true }); }
}
