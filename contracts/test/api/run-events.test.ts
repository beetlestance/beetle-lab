import { expect, it } from 'vitest';
import { validateApi } from '../../src/api/index.js';
const id = '00000000-0000-4000-8000-000000000001';
const scope = { kind: 'workspace', organizationId: id, workspaceId: id };
function page() {
  return { id, scope, activeAttemptId: id, generation: 1, afterSeq: 0, durableThrough: 1,
    coverage: 'contiguous', blockedReason: null, retainedStartSeq: null, resumeCursor: 'AA', nextCursor: null,
    items: [{ version: '1.0', organizationId: id, workspaceId: id, attemptId: id, generation: 1,
      seq: 1, phase: 'execute', observedAt: '2026-01-01T00:00:00Z', source: 'wrapper', wrapperSeq: 1,
      kind: 'progress', payload: { completedUnits: 0, totalUnits: 1, heartbeat: true, usefulProgress: false } }] };
}
it('shares the runner event schema in bounded public pages', () => {
  expect(validateApi('RunEventPage', page()).ok).toBe(true);
  expect(validateApi('RunEventPage', { ...page(), items: [], durableThrough: 0, coverage: 'pending' }).ok).toBe(true);
});
it('rejects unknown fields, malformed runner events and oversized structural bounds', () => {
  const value = page();
  for (const invalid of [{ ...value, other: 1 }, { ...value, generation: 2 },
    { ...value, items: [{ ...value.items[0], source: 'unknown' }] },
    { ...value, items: Array.from({ length: 101 }, () => value.items[0]) },
    { ...value, resumeCursor: 'a'.repeat(513) }, { ...value, afterSeq: -1 },
    { ...value, durableThrough: 65_537 }]) {
    expect(validateApi('RunEventPage', invalid).ok).toBe(false);
  }
});
