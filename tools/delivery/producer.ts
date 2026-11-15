import {spawn} from 'node:child_process';
import {constants, openSync, closeSync, createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {maximumArtifactZipBytes} from './identity.js';

type Kind = 'limit' | 'timeout' | 'stderr' | 'spawn' | 'pipe' | 'exit' | 'empty';
interface Exit {code: number | null; signal: NodeJS.Signals | null}
export class ArchiveProducerError extends Error {
  constructor(readonly kind: Kind, readonly exit: Exit) {super(`Archive producer ${kind}`);}
}
interface Input {executable: string; args: readonly string[]; destination: string; maximumBytes: number; timeoutMs?: number; allowEmptyOutput?: boolean}
function bound(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error('Archive producer bound');
  return value;
}
function requireOutput(bytes: number, allowEmpty: boolean | undefined, exit: Exit): void {
  if (!bytes && allowEmpty !== true) throw new ArchiveProducerError('empty', exit);
}
/** POSIX task-owned process group; failure never returns before the original close. */
export async function archiveProducer(input: Input): Promise<number> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error('POSIX archive producer required');
  const maximum = bound(input.maximumBytes, maximumArtifactZipBytes); const timeout = bound(input.timeoutMs ?? 120000, 120000);
  const descriptor = openSync(input.destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let child: ReturnType<typeof spawn>;
  try {child = spawn(input.executable, [...input.args], {detached: true, stdio: ['ignore', 'pipe', 'pipe']});}
  catch (error) {closeSync(descriptor); throw error;}
  let closed = false; let failure: Kind | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (kind: Kind) => {
    failure ??= kind;
    if (closed || child.pid === undefined) return;
    try {process.kill(-child.pid, 'SIGTERM');} catch { /* Original close remains authoritative. */ }
    killTimer ??= setTimeout(() => {
      if (!closed && child.pid !== undefined) {try {process.kill(-child.pid, 'SIGKILL');} catch { /* Join below. */ }}
    }, 100);
  };
  const termination = new Promise<Exit>(resolve => {
    child.once('error', () => stop('spawn'));
    child.once('close', (code, signal) => {closed = true; resolve({code, signal});});
  });
  let stderrBytes = 0;
  child.stderr!.on('data', (chunk: Buffer) => {stderrBytes += chunk.length; if (stderrBytes > 65536) stop('stderr');});
  child.stderr!.once('error', () => stop('stderr'));
  const deadline = setTimeout(() => stop('timeout'), timeout);
  let bytes = 0;
  const counter = new Transform({transform(chunk: Buffer, _encoding, callback) {
    if (chunk.length > maximum - bytes) {stop('limit'); callback(new Error('Archive output limit')); return;}
    bytes += chunk.length; callback(null, chunk);
  }});
  const output = createWriteStream(input.destination, {fd: descriptor, autoClose: true, highWaterMark: 65536});
  try {
    try {await pipeline(child.stdout!, counter, output);} catch {stop('pipe');}
    const exit = await termination;
    if (failure) throw new ArchiveProducerError(failure, exit);
    if (exit.code !== 0 || exit.signal !== null) throw new ArchiveProducerError('exit', exit);
    requireOutput(bytes, input.allowEmptyOutput, exit);
    return bytes;
  } finally {clearTimeout(deadline); clearTimeout(killTimer);}
}
