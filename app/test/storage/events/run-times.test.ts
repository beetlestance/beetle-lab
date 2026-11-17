import { expect, it } from 'vitest';
import type { AgentEvent } from '@beetle/contracts';
import { readRunTimes } from '../../../src/adapters/outbound/sqlite/run-annotations.js';
import { eventFixture, request } from './fixtures.js';
import { scope } from '../fixture.js';
import events from '../../../../contracts/fixtures/valid/events.json' with { type: 'json' };

const started = '2026-11-10T01:00:00.000Z';
const exited = '2026-11-10T01:05:00.000Z';
function runtimeBatch(f: ReturnType<typeof eventFixture>, after: number, kinds: AgentEvent['kind'][]) {
  const value = request(f.binding, after, kinds.length);
  value.batch.events = value.batch.events.map((event, index) => {
    const kind = kinds[index]!;
    const observedAt = kind === 'runtime.exited' ? exited : started;
    const template = events.events.find((value) => value.kind === kind)!;
    const payload = kind === 'runtime.exited' ? { ...template.payload, observedAt } : template.payload;
    return { ...event, kind, phase: template.phase, observedAt, payload } as AgentEvent;
  });
  return value;
}
const owner = (f: ReturnType<typeof eventFixture>) =>
  ({ id: f.binding.key.runId, scope, activeAttemptId: f.binding.key.attempt.attemptId });

it('derives start and finish only from durable agent runtime events on the active attempt', () => {
  const f = eventFixture();
  expect(readRunTimes(f.db, owner(f))).toEqual({ startedAt: null, finishedAt: null });
  f.store.execute({ kind: 'eventIngest', request: runtimeBatch(f, 0, ['runtime.started']) });
  expect(readRunTimes(f.db, owner(f))).toEqual({ startedAt: started, finishedAt: null });
  f.store.execute({ kind: 'eventIngest', request: runtimeBatch(f, 1, ['resource.summary', 'runtime.exited']) });
  expect(readRunTimes(f.db, owner(f))).toEqual({ startedAt: started, finishedAt: exited });
  expect(readRunTimes(f.db, { ...owner(f), activeAttemptId: '00000000-0000-4000-8000-0000000009ff' }))
    .toEqual({ startedAt: null, finishedAt: null });
  expect(readRunTimes(f.db, { ...owner(f), scope: { ...scope, workspaceId: '00000000-0000-4000-8000-0000000009fe' } }))
    .toEqual({ startedAt: null, finishedAt: null });
});

it('keeps the runtime read on the partial index', () => {
  const f = eventFixture();
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT seq FROM run_events e INDEXED BY run_events_runtime
    WHERE e.attempt_id=? AND e.generation=1 AND json_extract(e.canonical_json,'$.kind') IN ('runtime.started','runtime.exited')
    ORDER BY e.seq LIMIT 4`).all('x').map((row) => String(row.detail));
  expect(plan.join('\n')).toContain('run_events_runtime');
  expect(plan.join('\n')).not.toContain('TEMP B-TREE');
});
