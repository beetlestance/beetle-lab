import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runStarterCli } from '../starter-cli.js';
import { createStarterRequest } from '../starter.js';
import { canonical } from '../src/capture.js';
import { native } from '../src/files.js';

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'w318-starter-cli-'))); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const options = () => ({ root: join(root, 'installation'), uid: process.getuid!(), gid: process.getgid!(),
  externalOrigin: 'https://synthetic.invalid', agentOrigin: 'http://agent:4312', dockerSocket: '/run/docker.sock',
  agentContainer: 'synthetic-agent', agentImage: 'synthetic-agent:v1', engineImage: 'synthetic-engine:v1', targetNetwork: 'synthetic-target' });
async function input(value: unknown = options()): Promise<string> {
  const file = join(root, 'options.json'); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file;
}
function output() {
  return { stdout: vi.spyOn(process.stdout, 'write').mockReturnValue(true), stderr: vi.spyOn(process.stderr, 'write').mockReturnValue(true) };
}
function deferred() {
  let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise };
}

it.each([[], ['--options'], ['--request', '/tmp/x'], ['--options', 'relative'],
  ['--options', '/tmp/../x'], ['--options', '/tmp/x', '--options', '/tmp/y'], ['--options=/tmp/x']].map(args => ({ args })))('rejects CLI argument errors with fixed exit2: %j', async ({ args }) => {
  const o = output(); expect(await runStarterCli(args)).toBe(2);
  expect(o.stderr).toHaveBeenCalledExactlyOnceWith('invalid_input\n'); expect(o.stdout).not.toHaveBeenCalled();
});

it('reads private options and emits one bounded canonical request without changing the input or creating the target', async () => {
  const file = await input(); const before = await readFile(file); const o = output();
  const int = process.listenerCount('SIGINT'); const term = process.listenerCount('SIGTERM');
  expect(await runStarterCli(['--options', file])).toBe(0);
  expect(o.stderr).not.toHaveBeenCalled(); expect(o.stdout).toHaveBeenCalledExactlyOnceWith(canonical(createStarterRequest(options())) + '\n');
  const text = String(o.stdout.mock.calls[0]![0]); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);
  expect(text).not.toMatch(/credential|token|secret/iu);
  expect(await readFile(file)).toEqual(before); await expect(readFile(join(root, 'installation'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(process.listenerCount('SIGINT')).toBe(int); expect(process.listenerCount('SIGTERM')).toBe(term);
});

it.each(['malformed', 'extra', 'mode', 'oversize', 'symlink', 'hardlink', 'directory', 'missing', 'utf8'] as const)('keeps private options failure fixed and silent on stdout: %s', async kind => {
  let file = await input(); const canary = 'PRIVATE_OPTIONS_CANARY';
  if (kind === 'malformed') await writeFile(file, canary);
  if (kind === 'extra') await writeFile(file, JSON.stringify({ ...options(), canary }));
  if (kind === 'mode') await chmod(file, 0o644);
  if (kind === 'oversize') await writeFile(file, 'a'.repeat(262145));
  if (kind === 'symlink') { const target = join(root, 'linked.json'); await symlink(file, target); file = target; }
  if (kind === 'hardlink') await link(file, join(root, 'linked.json'));
  if (kind === 'directory') file = root;
  if (kind === 'missing') file = join(root, canary);
  if (kind === 'utf8') await writeFile(file, new Uint8Array([0xff]));
  const o = output(); expect(await runStarterCli(['--options', file])).toBe(1);
  expect(o.stdout).not.toHaveBeenCalled(); expect(o.stderr).toHaveBeenCalledOnce();
  expect(['invalid_input\n', 'unsafe_root\n']).toContain(o.stderr.mock.calls[0]![0]);
});

it.each(['SIGINT', 'SIGTERM', 'deadline'] as const)('retains the original options read and closes before fixed failure: %s', async cause => {
  const file = await input(); const entered = deferred(); const held = deferred(); let closed = false; let settled = false;
  const now = performance.now(); let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now + elapsed);
  const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args); const read = handle.read.bind(handle); const close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockImplementationOnce(async (...readArgs: Parameters<FileHandle['read']>) => {
      entered.release(); await held.promise; return read(...readArgs);
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed = true; }); return handle;
  });
  const o = output(); const pending = runStarterCli(['--options', file]).finally(() => { settled = true; });
  await entered.promise;
  if (cause === 'deadline') elapsed = 30001; else process.emit(cause);
  await new Promise(resolve => setImmediate(resolve)); expect(settled).toBe(false); expect(closed).toBe(false);
  held.release(); expect(await pending).toBe(1); expect(closed).toBe(true);
  expect(o.stdout).not.toHaveBeenCalled(); expect(o.stderr).toHaveBeenCalledExactlyOnceWith(cause === 'deadline' ? 'deadline\n' : 'cancelled\n');
});
