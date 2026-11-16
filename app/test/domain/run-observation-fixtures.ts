import { readFileSync } from 'node:fs';
import type { AttemptSnapshot, EngineResult } from '@beetle/contracts';
import { mergeAttemptObservation } from '../../src/domain/runs/index.js';

export const identity = Object.freeze({ attemptId: '00000000-0000-4000-8000-000000000003',
  organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  generation: 1, intentDigest: 'a'.repeat(64) });
export const other = '00000000-0000-4000-8000-000000000099';
export function snapshot(patch: Partial<AttemptSnapshot> = {}): AttemptSnapshot {
  return { protocolVersion: '1.0', ...identity, state: 'offered', lastSeq: 0, retainedStartSeq: 0,
    cancelRequested: false, ...patch };
}
export function result(): EngineResult {
  return JSON.parse(readFileSync(new URL('../../../contracts/fixtures/valid/passed-result.json', import.meta.url), 'utf8')) as EngineResult;
}
export const exit = () => ({ exitCode: null, oomKilled: null, observedAt: '2026-01-01T00:00:00.000Z' });
export function merge(incoming: unknown, previous: Readonly<AttemptSnapshot> | null = null) {
  return mergeAttemptObservation({ expected: identity, previous, incoming });
}
