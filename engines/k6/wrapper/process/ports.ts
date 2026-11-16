import { spawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { NativeProcessOptions } from './types.js';

export type OwnedChild = ChildProcessByStdio<null, Readable, Readable>;
/** Private test seam: never supplied from staged input or exported by the public entrypoint. */
export interface ProcessPorts {
  spawn: (binary: string, args: readonly string[], options: SpawnOptions) => OwnedChild;
  group: (pid: number, signal: NodeJS.Signals | 0) => 'present' | 'absent' | 'unknown';
  validate: (input: NativeProcessOptions) => Promise<void>;
}
export function fixedLaunch(input: NativeProcessOptions): { args: string[]; options: SpawnOptions } {
  return { args: ['run', '--no-usage-report', '--quiet', '--no-color', '--address', '',
    '--log-output', 'stderr', '--log-format', 'json', '--config', input.emptyConfig, '--out', 'json=-', input.script],
  options: { cwd: input.directory, shell: false, detached: true, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: { K6_NO_USAGE_REPORT: 'true', LANG: 'C', LC_ALL: 'C' } } };
}
export function nodeSpawn(binary: string, args: readonly string[], options: SpawnOptions): OwnedChild {
  return spawn(binary, args, options) as OwnedChild;
}
export function ownedGroup(pid: number, signal: NodeJS.Signals | 0): 'present' | 'absent' | 'unknown' {
  if (!Number.isSafeInteger(pid) || pid <= 1) return 'unknown';
  try { process.kill(-pid, signal); return 'present'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'; }
}
