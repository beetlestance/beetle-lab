import { K6_EXIT_PROTOCOL_IMAGE_ENV, K6_WRAPPER_OUTPUT_LIMIT_EXIT } from '@beetle/contracts/k6-diagnostics';
import { expect, it } from 'vitest';
import { RuntimeEvidence } from '../../src/supervisor/evidence.js';
import { JournalError } from '../../src/journal/index.js';
import { id, now, port, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
it('coalesces repeated lifecycle inspections into four exact first events during persistent delivery failure', async () => {
  const s = await f.setup(); const base = port(s.journal); let unavailable = true;
  const evidence = new RuntimeEvidence({ ...base, appendSupervisor: input => {
    if (unavailable) return Promise.reject(new JournalError('queue_full'));
    return base.appendSupervisor(input);
  } }, s.input.key);
  const running = { id, state: 'running' as const, exitCode: null, oomKilled: false };
  const exited = { id, state: 'exited' as const, exitCode: 137, oomKilled: false };
  evidence.observe(running, now, 'none');
  await expect(evidence.flush()).rejects.toMatchObject({ code: 'queue_full' });
  await s.journal.supervision({ key: s.input.key, now, cancel: true });
  evidence.cancelled(now, now + 1);
  evidence.observe(exited, now + 2, 'cancelled');
  evidence.observe({ state: 'missing' }, now + 3, 'cancelled');
  for (let index = 0; index < 1000; index++) {
    evidence.cancelled(now, now + 4 + index);
    evidence.observe(exited, now + 4 + index, 'cancelled');
    evidence.observe({ state: 'missing' }, now + 4 + index, 'cancelled');
    evidence.observe({ state: 'unknown', reason: 'unavailable' }, now + 4 + index, 'cancelled');
  }
  expect(evidence.hasPending).toBe(true);
  unavailable = false; await evidence.flush(); await evidence.flush();
  const events = (await s.journal.readEvents(s.input.key, 0)).events.slice(1);
  expect(events.map(event => event.kind)).toEqual(['runtime.started', 'cancellation.requested', 'runtime.exited', 'execution.lost']);
  expect(events.map(event => event.observedAt)).toEqual([now, now + 1, now + 2, now + 3].map(value => new Date(value).toISOString()));
  expect(events[2]?.payload).toEqual({ exitCode: 137, oomKilled: false, observedAt: new Date(now + 2).toISOString(), reason: 'cancelled' });
  expect(evidence.hasPending).toBe(false);
});

it.each([
  { capable: true, cause: 'none', oom: false, code: K6_WRAPPER_OUTPUT_LIMIT_EXIT, reason: 'output_limit' },
  { capable: false, cause: 'none', oom: false, code: K6_WRAPPER_OUTPUT_LIMIT_EXIT, reason: undefined },
  { capable: true, cause: 'none', oom: false, code: 1, reason: undefined },
  { capable: true, cause: 'none', oom: true, code: K6_WRAPPER_OUTPUT_LIMIT_EXIT, reason: 'memory_limit' },
  { capable: true, cause: 'timeout', oom: false, code: K6_WRAPPER_OUTPUT_LIMIT_EXIT, reason: 'output_limit' },
] as const)('records only an authenticated k6 wrapper exit cause ($capable $cause $code $oom)', async ({ capable, cause, oom, code, reason }) => {
  const s = await f.setup();
  const evidence = new RuntimeEvidence(port(s.journal), s.input.key, capable ? [K6_EXIT_PROTOCOL_IMAGE_ENV] : []);
  evidence.observe({ id, state: 'exited', exitCode: code, oomKilled: oom }, now, cause, 'k6');
  await evidence.flush();
  const event = (await s.journal.readEvents(s.input.key, 0)).events.find((event) => event.kind === 'runtime.exited');
  expect(event?.payload).toEqual({
    exitCode: code,
    oomKilled: oom,
    observedAt: new Date(now).toISOString(),
    ...(reason === undefined ? {} : { reason }),
  });
});

it('replays the same physical output-limit witness after restart and a late durable cancel', async () => {
  const s = await f.setup();
  const first = new RuntimeEvidence(port(s.journal), s.input.key, [K6_EXIT_PROTOCOL_IMAGE_ENV]);
  const view = { id, state: 'exited' as const, exitCode: K6_WRAPPER_OUTPUT_LIMIT_EXIT, oomKilled: false };
  first.observe(view, now, 'none', 'k6');
  await first.flush();
  await s.journal.supervision({ key: s.input.key, now: now + 1, cancel: true });
  const restarted = new RuntimeEvidence(port(s.journal), s.input.key, [K6_EXIT_PROTOCOL_IMAGE_ENV]);
  restarted.observe(view, now + 2, 'cancelled', 'k6');
  await restarted.flush();
  const snapshot = await s.journal.get(s.input.key);
  expect(snapshot.cancelRequested).toBe(true);
  expect(snapshot.exitEvidence).toMatchObject({ exitCode: K6_WRAPPER_OUTPUT_LIMIT_EXIT, reason: 'output_limit' });
});
