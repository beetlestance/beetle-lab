import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { digest, packetDigest } from './digest.js';
import { safeRelative, validatePacket } from './validate.js';
import type { DispatchState, TaskPacket } from './types.js';
async function checkRead(root: string, read: TaskPacket['requiredReads'][number]): Promise<void> {
  const path = await realpath(resolve(root, read.path));
  const rel = relative(root, path);
  if (isAbsolute(rel) || !safeRelative(rel)) throw new Error(`Read escapes worktree or resolves to forbidden path: ${read.path}`);
  if (digest(await readFile(path)) !== read.sha256) throw new Error(`Stale context: ${read.path}`);
}
function checkAcceptance(packet: TaskPacket, state: DispatchState): void {
  const approvedBase = state.acceptedCommits.has(packet.baseCommit) || state.correctionPackets?.has(packet.packetHash);
  if (!approvedBase) throw new Error('Unaccepted dependency baseline');
  if (![packet.contractCommit, ...packet.dependencyCommits]
    .every(commit => state.acceptedCommits.has(commit))) throw new Error('Unaccepted dependency');
}
export async function preflight(input: unknown, directory: string, state: DispatchState): Promise<TaskPacket> {
  const packet = validatePacket(input);
  if (packetDigest(packet) !== packet.packetHash) throw new Error('Packet digest mismatch');
  if (state.head !== packet.baseCommit || state.branch !== packet.branch) throw new Error('Wrong worktree base/branch');
  if (state.dirtyPaths.length) throw new Error('Worktree has unapproved dirty inputs');
  checkAcceptance(packet, state);
  if (!state.availableModels.includes(packet.model)) throw new Error('Model unavailable');
  const root = await realpath(directory);
  if (root !== await realpath(packet.worktree)) throw new Error('Wrong worktree location');
  for (const read of packet.requiredReads) await checkRead(root, read);
  return packet;
}
export function auditWrites(packet: TaskPacket, changed: readonly string[]): void {
  if (packet.role === 'reviewer' && changed.length) throw new Error('Reviewer changed files');
  for (const path of changed) {
    if (!safeRelative(path) || path.split('/').includes('.')) throw new Error(`Unsafe changed path: ${path}`);
    const allowed = packet.allowedWrites.some(pattern => pattern.endsWith('/**')
      ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
    if (!allowed) throw new Error(`Out-of-scope mutation: ${path}`);
  }
}
