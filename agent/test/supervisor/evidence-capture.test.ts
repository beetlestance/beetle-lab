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
