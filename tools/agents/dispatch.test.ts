import { expect, it } from 'vitest';
import { checkClaims } from './dispatch.js';
import type { TaskPacket } from './types.js';

const packet: TaskPacket = { packetVersion: 1, taskId: 'test-dispatch', worktree: '/tmp/synthetic',
  baseCommit: 'a'.repeat(40), contractCommit: 'a'.repeat(40), dependencyCommits: [],
  branch: 'rewrite/test', model: 'gpt-6.1-sol', role: 'worker', requiredTools: ['exec_command'],
  locks: ['contracts'], allowedWrites: ['contracts/runner/**'], requiredReads: [], acceptanceIds: ['V01'],
  purpose: 'Synthetic claim conflict vector', reportPath: '.agent-work/reports/test-dispatch/result.md', packetHash: 'b'.repeat(64) };
const environment = { availableModels: ['gpt-6.1-sol'], availableTools: ['exec_command'] };
const ledger = { acceptedCommits: [packet.baseCommit], revokedHashes: [], active: [] };

it('requires a tool and rejects revoked or concurrently owned scopes before dispatch', () => {
  expect(() => checkClaims(packet, ledger, environment)).not.toThrow();
  expect(() => checkClaims(packet, ledger, { ...environment, availableTools: [] })).toThrow('Tool unavailable');
  expect(() => checkClaims(packet, { ...ledger, revokedHashes: [packet.packetHash] }, environment)).toThrow('Revoked');
  const sameLock = { taskId: 'other', worktree: '/tmp/other', branch: 'rewrite/other', locks: ['contracts'], allowedWrites: [] };
  expect(() => checkClaims(packet, { ...ledger, active: [sameLock] }, environment)).toThrow('Lock conflict');
  const sameOwner = { ...sameLock, locks: [], allowedWrites: ['contracts/**'] };
  expect(() => checkClaims(packet, { ...ledger, active: [sameOwner] }, environment)).toThrow('Ownership conflict');
  expect(() => checkClaims(packet, { ...ledger, active: [{ ...sameLock, worktree: packet.worktree }] }, environment)).toThrow('already owned');
  expect(() => checkClaims(packet, { ...ledger, active: [sameLock, sameLock, sameLock] }, environment)).toThrow('capacity');
});
