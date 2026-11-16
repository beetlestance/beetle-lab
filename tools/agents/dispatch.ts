import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { preflight } from './preflight.js';
import { checkWritePaths } from './write-paths.js';
import type { TaskPacket } from './types.js';

const execute = promisify(execFile);
export interface DispatchLedger {
  acceptedCommits: string[];
  revokedHashes: string[];
  correctionPackets?: string[];
  active: { taskId: string; worktree: string; branch: string; locks: string[]; allowedWrites: string[] }[];
}
export interface DispatchEnvironment {
  availableModels: string[];
  availableTools: string[];
}
function overlap(a: string, b: string): boolean {
  const first = a.endsWith('/**') ? a.slice(0, -2) : a;
  const second = b.endsWith('/**') ? b.slice(0, -2) : b;
  return first === second || first.startsWith(second) || second.startsWith(first);
}
export function checkClaims(packet: TaskPacket, ledger: DispatchLedger, environment: DispatchEnvironment): void {
  if (ledger.revokedHashes.includes(packet.packetHash)) throw new Error('Revoked packet');
  if (ledger.active.length >= 3) throw new Error('Worker capacity exhausted');
  if (!packet.requiredTools.every(tool => environment.availableTools.includes(tool))) throw new Error('Tool unavailable');
  for (const task of ledger.active) {
    if (task.worktree === packet.worktree || task.branch === packet.branch) throw new Error('Worktree or branch already owned');
    if (task.taskId === packet.taskId || task.locks.some(lock => packet.locks.includes(lock))) throw new Error('Lock conflict');
    if (task.allowedWrites.some(a => packet.allowedWrites.some(b => overlap(a, b)))) throw new Error('Ownership conflict');
  }
}
async function git(directory: string, args: string[]): Promise<string> {
  const result = await execute('git', ['-C', directory, ...args], { maxBuffer: 1024 * 1024, timeout: 10_000 });
  return result.stdout.trim();
}
/** Coordinator calls serially and records the claim before spawning; not an OS sandbox. */
export async function prepareDispatch(input: unknown, directory: string, ledger: DispatchLedger,
  environment: DispatchEnvironment): Promise<TaskPacket> {
  const root = await realpath(directory);
  const [head, branch, status, top] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']), git(root, ['branch', '--show-current']),
    git(root, ['status', '--porcelain', '--untracked-files=all']), git(root, ['rev-parse', '--show-toplevel'])
  ]);
  if (root !== await realpath(top)) throw new Error('Directory is not a worktree root');
  const packet = await preflight(input, root, { head, branch, dirtyPaths: status ? [status] : [],
    acceptedCommits: new Set(ledger.acceptedCommits), correctionPackets: new Set(ledger.correctionPackets),
    availableModels: environment.availableModels });
  checkClaims(packet, ledger, environment);
  await checkWritePaths(root, packet.allowedWrites.map(path => path.replace(/\/\*\*$/, '')));
  for (const commit of new Set([packet.contractCommit, ...packet.dependencyCommits])) {
    await git(root, ['merge-base', '--is-ancestor', commit, head]);
  }
  return packet;
}
