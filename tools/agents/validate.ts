import { isAbsolute } from 'node:path';
import { models } from './types.js';
import type { TaskPacket } from './types.js';
const sha = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const forbidden = /(^|\/)(\.git|node_modules|configs|\.aws|\.ssh)(\/|$)|(^|\/)\.env(?:\.|$)/;
export function safeRelative(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.includes('\\')
    && !path.split('/').some(part => ['..', '.', ''].includes(part)) && !forbidden.test(path);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function validateLists(value: Record<string, unknown>): boolean {
  return strings(value.allowedWrites) && strings(value.dependencyCommits)
    && strings(value.acceptanceIds) && strings(value.requiredTools) && strings(value.locks) && Array.isArray(value.requiredReads)
    && value.requiredReads.length > 0 && value.requiredReads.every(read =>
      record(read) && typeof read.path === 'string' && typeof read.sha256 === 'string'
      && safeRelative(read.path) && sha.test(read.sha256));
}
function validateIdentity(packet: TaskPacket): void {
  if (!isAbsolute(packet.worktree)) throw new Error('Worktree must be absolute');
  if (packet.packetVersion !== 1 || !/^[a-z0-9-]{2,64}$/.test(packet.taskId)) throw new Error('Invalid packet identity');
  if (![packet.baseCommit, packet.contractCommit, ...packet.dependencyCommits].every(item => commit.test(item))) {
    throw new Error('Invalid commit identity');
  }
  if (!models.includes(packet.model) || !['worker', 'reviewer'].includes(packet.role)) throw new Error('Unsupported agent role/model');
  if (!sha.test(packet.packetHash) || !packet.purpose.trim()) throw new Error('Invalid packet hash/purpose');
}
function validateScope(packet: TaskPacket): void {
  if (packet.role === 'reviewer' && packet.allowedWrites.length) throw new Error('Reviewer cannot write');
  if (!packet.allowedWrites.every(path => safeRelative(path) && !['*', '**', '**/*', '.'].includes(path))) throw new Error('Unsafe write scope');
  if (!packet.requiredReads.some(read => read.path === 'AGENTS.md')) throw new Error('Missing instruction snapshot');
  if (!safeRelative(packet.reportPath) || !packet.reportPath.startsWith(`.agent-work/reports/${packet.taskId}/`)) throw new Error('Unsafe report path');
}
export function validatePacket(value: unknown): TaskPacket {
  if (!record(value) || !validateLists(value)) throw new Error('Invalid packet fields');
  const stringKeys = ['taskId', 'worktree', 'baseCommit', 'contractCommit', 'branch', 'purpose', 'reportPath', 'packetHash', 'model'];
  if (!stringKeys.every(key => typeof value[key] === 'string')) throw new Error('Missing packet fields');
  const packet = value as unknown as TaskPacket;
  validateIdentity(packet);
  validateScope(packet);
  return packet;
}
