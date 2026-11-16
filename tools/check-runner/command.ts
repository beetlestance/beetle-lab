import { spawn } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Check } from './plan.js';

export type Status = 'passed' | 'failed' | 'timeout' | 'output_limit' | 'cancelled' | 'spawn_error';
export interface Result { id: string; argv: string[]; status: Status; exitCode: number | null; signal: string | null; elapsedMs: number; logBytes: number; error: string | null }
interface Options { check: Check; cwd: string; logPath: string; signal?: AbortSignal }
const logLimit = 1048576;
export async function runCommand(options: Options): Promise<Result> {
  const log = await open(options.logPath, 'wx', 0o600);
  try { return await execute(options, log); } finally { await log.close(); }
}
function execute({check, cwd, signal}: Options, log: FileHandle): Promise<Result> {
  const started = performance.now();
  return new Promise(resolve => {
    let status: Status | undefined; let bytes = 0; let failure: string | null = null; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(check.argv[0]!, check.argv.slice(1), {cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    const kill = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, name); } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
      }
    };
    const stop = (reason: Status) => {
      if (status) return;
      status = reason; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 100);
    };
    const abort = () => stop('cancelled');
    const consume = (data: Buffer) => {
      if (status) return;
      const accepted = Math.min(data.length, logLimit - bytes);
      try {
        let written = 0;
        while (written < accepted) written += writeSync(log.fd, data, written, accepted - written);
      } catch (error) { failure = error instanceof Error ? error.message.slice(0, 512) : 'Log write failed'; stop('failed'); return; }
      bytes += accepted;
      if (accepted < data.length) stop('output_limit');
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.on('error', error => { failure = error.message.slice(0, 512); status ??= 'spawn_error'; });
    const timer = setTimeout(() => stop('timeout'), check.timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    child.on('close', (code, termination) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (killTimer) { clearTimeout(killTimer); kill('SIGKILL'); }
      resolve({id: check.id, argv: check.argv, status: status ?? (code === 0 ? 'passed' : 'failed'),
        exitCode: code, signal: termination, elapsedMs: Math.round(performance.now() - started), logBytes: bytes, error: failure});
    });
  });
}
