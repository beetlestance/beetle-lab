import { expect, it } from 'vitest';
import { project } from './projection.js';
import { event, page } from './fixtures.js';
it('bounds rows and serialized bytes, keeps notice, deduplicates and preserves empty-poll facts', () => {
  const first = project(page({ through: 100 }));
  const next = project(page({ after: 100, through: 200 }), first);
  expect(next.rows).toHaveLength(100); expect(next.rows[0]?.seq).toBe(101); expect(next.omitted).toBe(true);
  expect(project(page({ after: 200, through: 200 }), next)).toMatchObject({ rows: next.rows, omitted: true });
  expect(project(page({ after: 100, through: 200 }), next).rows).toEqual(next.rows);
  const inflated = { ...first, rows: first.rows.map(row => ({ ...row, text: '界'.repeat(1000) })) };
  const bounded = project(page({ after: 100, through: 100 }), inflated);
  expect(new TextEncoder().encode(JSON.stringify(bounded.rows)).byteLength).toBeLessThanOrEqual(65536);
  expect(bounded.omitted).toBe(true);
});
it('only phase transitions and increasing useful nonheartbeat counts advance progress', () => {
  const base = event(1);
  const started = { ...base, source: 'wrapper' as const, wrapperSeq: 1, kind: 'phase.started' as const,
    payload: { budget: { phase: 'execute' as const, timeoutMs: 100, workUnits: 10, outputBytes: 100 } } };
  const first = project({ ...page({ through: 1 }), items: [started] });
  const progress = (seq: number, completedUnits: number, heartbeat = false) => ({ ...base, seq, source: 'wrapper' as const,
    wrapperSeq: seq, observedAt: `2026-11-10T00:00:0${seq}.000Z`, kind: 'progress' as const,
    payload: { completedUnits, totalUnits: 0, heartbeat, usefulProgress: true } });
  const increased = project({ ...page({ after: 1, through: 2 }), items: [progress(2, 2)] }, first);
  const repeated = project({ ...page({ after: 2, through: 3 }), items: [progress(3, 2)] }, increased);
  const heartbeat = project({ ...page({ after: 3, through: 4 }), items: [progress(4, 8, true)] }, repeated);
  expect(heartbeat.progress).toEqual(increased.progress); expect(heartbeat.progress?.total).toBe(0);
  const phase = { ...started, seq: 5, phase: 'collect' as const, payload: { budget: { ...started.payload.budget, phase: 'collect' as const } } };
  expect(project({ ...page({ after: 4, through: 5 }), items: [phase] }, heartbeat).progress).toMatchObject({ phase: 'collect', completed: 0 });
});
it('projects zero resources distinctly and strips runtime IDs and artifact paths', () => {
  const base = event(1);
  const summary = { ...base, kind: 'resource.summary' as const, payload: { scope: 'container' as const, cpuMillis: 0,
    peakMemoryBytes: 0, peakPids: 0, outputBytes: 0, enforcedControls: [], source: 'docker-stats' as const, lastSampleAt: base.observedAt, samples: 1, missedSamples: 0, reason: null } };
  const data = project({ ...page({ through: 1 }), items: [summary] });
  expect(data.resources).toContain('CPU time 0 ms'); expect(data.resources).toContain('peak memory 0 bytes');
  expect(project(page()).resources).toBeNull();
  const sealed = { ...base, seq: 2, source: 'wrapper' as const, wrapperSeq: 1, kind: 'artifact.sealed' as const,
    payload: { artifactId: base.attemptId, kind: 'log', relativePath: 'private/path', bytes: 0, sha256: 'a'.repeat(64), sealedAt: base.observedAt } };
  const projected = project({ ...page({ through: 2 }), items: [base, sealed] });
  expect(JSON.stringify(projected)).not.toContain('private');
});
it('records useful phase completion even when the recent tail omitted its start', () => {
  const finished = { ...event(1), source: 'wrapper' as const, wrapperSeq: 1, kind: 'phase.finished' as const,
    payload: { completedUnits: 12, outputBytes: 0 } };
  const data = project({ ...page({ through: 1 }), items: [finished] });
  expect(data.progress).toMatchObject({ phase: 'execute', completed: 12, total: 0, usefulAt: finished.observedAt });
  const repeat = { ...finished, seq: 2, observedAt: '2026-11-10T00:00:02.000Z' };
  expect(project({ ...page({ after: 1, through: 2 }), items: [repeat] }, data).progress).toEqual(data.progress);
});
it('phase end is useful even with zero units and a repeated end preserves its clock', () => {
  const started = { ...event(1), source: 'wrapper' as const, wrapperSeq: 1, kind: 'phase.started' as const,
    payload: { budget: { phase: 'execute' as const, timeoutMs: 1, workUnits: 1, outputBytes: 1 } } };
  const finished = { ...started, seq: 2, observedAt: '2026-11-10T00:00:02.000Z', kind: 'phase.finished' as const,
    payload: { completedUnits: 0, outputBytes: 0 } };
  const data = project({ ...page({ through: 2 }), items: [started, finished] });
  expect(data.progress?.usefulAt).toBe(finished.observedAt);
  expect(data.progress?.completed).toBe(0);
  expect(project({ ...page({ after: 2, through: 3 }), items: [{ ...finished, seq: 3, observedAt: '2026-11-10T00:00:03.000Z' }] }, data).progress).toEqual(data.progress);
});

it('labels unavailable resource values and sampled coverage without inventing zero', () => {
  const base = event(1);
  const summary = { ...base, kind: 'resource.summary' as const, payload: { scope: 'container' as const,
    cpuMillis: null, peakMemoryBytes: null, peakPids: null, outputBytes: null, enforcedControls: [],
    source: 'docker-stats' as const, lastSampleAt: null, samples: 0, missedSamples: 3, reason: 'unavailable' as const } };
  const data = project({ ...page({ through: 1 }), items: [summary] });
  expect(data.resources).toContain('CPU time not reported');
  expect(data.resources).toContain('sampled peak memory not reported');
  expect(data.resources).toContain('missed 3');
  expect(data.resources).toContain('observation unavailable');
  expect(data.resources).not.toContain('0 ms');
});
