import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { validateAttempt } from '../../runtime/index.js';
import { ProcessBoundaryError } from './types.js';
import type { NativeProcessOptions } from './types.js';

export function validateRuntimeHost(platform = process.platform, arch = process.arch): void {
  if (platform !== 'linux' || !['x64', 'arm64'].includes(arch)) throw new ProcessBoundaryError('profile');
}
export function snapshot(input: NativeProcessOptions): NativeProcessOptions {
  try {
    const attempt = validateAttempt(input.attempt);
    if (attempt.mode !== 'managed' || typeof input.sink !== 'function') throw 0;
    validatePaths(input);
    if (input.script !== join(input.directory, 'suite.js')) throw 0;
    positive(input.maxMetricStreamBytes, Number.MAX_SAFE_INTEGER);
    positive(input.maxDiagnosticBytes, 65_536); positive(input.drainTimeoutMs, 1000);
    const clock = input.clock && Object.freeze({ wall: input.clock.wall, monotonic: input.clock.monotonic });
    return Object.freeze({ ...input, attempt: Object.freeze(attempt), ...(clock ? { clock } : {}) });
  } catch { throw new ProcessBoundaryError('profile'); }
}
function validatePaths(input: NativeProcessOptions): void {
  for (const value of [input.binary, input.emptyConfig, input.directory, input.script]) {
    if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw 0;
  }
}
function positive(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw 0;
}
async function resolved(path: string): Promise<void> {
  if (await realpath(path) !== path) throw 0;
}
async function file(path: string, maximum: number, executable = false): Promise<void> {
  await resolved(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw 0;
  if (executable && (stat.mode & 0o111) === 0) throw 0;
}
async function emptyConfig(path: string): Promise<void> {
  await file(path, 16);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(17);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, read.bytesRead).toString('utf8').trim() !== '{}') throw 0;
  } finally { await handle.close(); }
}
/** The caller supplies immutable image paths and a task-owned directory, without hostile replacement. */
export async function validateProfile(input: NativeProcessOptions): Promise<void> {
  try {
    if (process.platform !== 'linux' && process.platform !== 'darwin') throw 0;
    await ownedDirectory(input.directory);
    await file(input.binary, Number.MAX_SAFE_INTEGER, true);
    await emptyConfig(input.emptyConfig);
    await ownedScript(input.script);
    if (dirname(input.script) !== input.directory) throw 0;
    try { await lstat(join(input.directory, 'beetle-evidence.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw 0;
  } catch { throw new ProcessBoundaryError('profile'); }
}
async function ownedDirectory(path: string): Promise<void> {
  await resolved(path);
  const directory = await lstat(path);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o022) !== 0) throw 0;
}
async function ownedScript(path: string): Promise<void> {
  await file(path, 67_108_864);
  const stat = await lstat(path);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) throw 0;
}
