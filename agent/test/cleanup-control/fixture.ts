import type { NativeCleanupPlan, CleanupProgress, NativeDirectoryFact } from '../../src/cleanup-control/index.js';
import { nativeCleanupPlanIdentity } from '../../src/cleanup-control/index.js';
export const directory: NativeDirectoryFact = { dev: '9007199254740993', ino: '9007199254740995', uid: '10001', gid: '10001', mode: String(0o40700) };
export const file = { ...directory, ino: '9007199254740997', mode: String(0o100400), bytes: '0', links: '1' as const };
export function plan(): NativeCleanupPlan {
  return { protocolVersion: 1, purpose: 'performance', original: {
    organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: '00000000-0000-4000-8000-000000000003', generation: 1, intentDigest: 'a'.repeat(64) },
    namespaceIdentity: 'b'.repeat(64), taskNamespaceIdentity: 'c'.repeat(64), retirementRequestDigest: 'd'.repeat(64), retirementVersion: 1,
    entries: [{ path: '', kind: 'directory', native: directory }, { path: 'input', kind: 'directory', native: { ...directory, ino: '10' } },
      { path: 'input/data.bin', kind: 'file', native: file }] };
}
export function progress(removedCount = 0, state: CleanupProgress['state'] = 'cleaning'): CleanupProgress {
  return { protocolVersion: 1, planIdentity: nativeCleanupPlanIdentity(plan()), entryCount: 3, removedCount,
    version: state === 'prepared' ? 1 : removedCount + 2, state };
}
