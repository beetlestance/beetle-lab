import { expect, it, vi } from 'vitest';
import { runtimeAbsentFacts } from '../../src/runtime-retirement/index.js';
import type { RuntimeAbsent } from '../../src/runtime-retirement/index.js';
import type { ProducerBarrier } from '../../src/producer-retirement/index.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { operation } from '../staging/fixtures.js';
import { fixture } from './fixtures.js';
import { unavailable } from '../backends/docker/fixtures.js';
const f = fixture();
it('derives writer absence from genuine producer, immutable Journal/ACK/namespace and exact original removal', async () => {
  const e = await f.ready(); const before = await e.owner.get(e.key); const token = await e.runtime.retire(e.producer, operation());
  expect(runtimeAbsentFacts(token, e.owner.retirements)).toMatchObject({ daemonId: e.configuration.expectedDaemonId,
    runtime: { kind: 'absent', runtimeId: 'b'.repeat(64), specDigest: e.plan.specDigest } });
  expect(e.docker.mutations().map(value => value.path)).toEqual([`/v1.47/containers/${'b'.repeat(64)}?force=false&v=false`]);
  expect(await e.owner.get(e.key)).toEqual(before); expect(e.runtime.status().retained).toBe(0);
  expect(() => runtimeAbsentFacts({} as RuntimeAbsent, e.owner.retirements)).toThrow('closed');
});
it('rejects another Journal producer capability and forged input before native observation', async () => {
  const first = await f.ready(); const second = await f.ready();
  expect(() => producerBarrierFacts(second.producer, first.owner.retirements)).toThrow('conflict');
  await expect(first.runtime.retire(second.producer, operation())).rejects.toMatchObject({ reason: 'conflict' });
  await expect(first.runtime.retire({} as ProducerBarrier, operation())).rejects.toMatchObject({ reason: 'conflict' });
  expect(first.docker.calls).toHaveLength(0);
});
it('rejects foreign daemon, keeps it unresolved and retries only after exact current authority returns', async () => {
  const e = await f.ready(); e.docker.daemonId = 'foreign-daemon';
  await expect(e.runtime.retire(e.producer, operation())).rejects.toMatchObject({ reason: 'unresolved' });
  expect(e.docker.mutations()).toHaveLength(0); expect(e.runtime.status().retained).toBe(1);
  e.docker.daemonId = e.configuration.expectedDaemonId;
  const token = await e.runtime.retire(e.producer, operation()); expect(runtimeAbsentFacts(token, e.owner.retirements).runtime.kind).toBe('absent');
});
it('captures caller budget before async work and rejects accessors before any Journal/native phase', async () => {
  const e = await f.ready(); const getter = vi.fn(() => performance.now() + 5000);
  const input = Object.defineProperty({}, 'deadline', { get: getter }) as { deadline: number };
  await expect(e.runtime.retire(e.producer, input)).rejects.toMatchObject({ reason: 'invalid_input' });
  expect(getter).not.toHaveBeenCalled(); expect(e.docker.calls).toHaveLength(0);
  const budget = operation(); const work = e.runtime.retire(e.producer, budget); budget.deadline = -1;
  const token = await work; expect(runtimeAbsentFacts(token, e.owner.retirements).runtime.kind).toBe('absent');
});
it('keeps unknown deletion explicit and reconciles the same original without replaying a blind DELETE', async () => {
  const e = await f.ready(); e.docker.intercept = input => {
    if (input.method === 'DELETE') { e.docker.state = undefined; return unavailable(); } return undefined;
  };
  await expect(e.runtime.retire(e.producer, operation())).rejects.toMatchObject({ reason: 'unresolved' });
  expect(e.runtime.status().retained).toBe(1); e.docker.intercept = undefined;
  const token = await e.runtime.retire(e.producer, operation()); expect(runtimeAbsentFacts(token, e.owner.retirements).runtime.kind).toBe('absent');
  expect(e.docker.mutations()).toHaveLength(1);
});
it('revokes writer authority on either runtime or producer owner closure', async () => {
  const first = await f.ready(); const token = await first.runtime.retire(first.producer, operation()); await first.runtime.close();
  expect(() => runtimeAbsentFacts(token, first.owner.retirements)).toThrow('closed');
  const second = await f.ready(); const other = await second.runtime.retire(second.producer, operation()); await second.coordinator.close();
  expect(() => runtimeAbsentFacts(other, second.owner.retirements)).toThrow('closed');
});
it('holds issued inspection through close and dispatches no late DELETE after the original is released', async () => {
  const e = await f.ready(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
  e.docker.intercept = async input => {
    if (input.path === `/v1.47/containers/${'b'.repeat(64)}/json`) { enter(); await held; return e.docker.respond(input); }
    return e.docker.respond(input);
  };
  const work = e.runtime.retire(e.producer, operation()); void work.catch(() => undefined);
  let settled = false; void work.finally(() => { settled = true; }).catch(() => undefined);
  try {
    await entered; const close = e.runtime.close(); void close.catch(() => undefined);
    await Promise.resolve(); expect(settled).toBe(false); expect(e.docker.mutations()).toHaveLength(0);
    release(); await expect(work).rejects.toMatchObject({ reason: 'closed' }); await expect(close).rejects.toMatchObject({ reason: 'unresolved' });
    expect(e.docker.mutations()).toHaveLength(0); expect(e.runtime.status().retained).toBe(1);
  } finally { release(); await Promise.allSettled([work]); }
});
it('refuses capacity before caller budget inspection or another native effect', async () => {
  const e = await f.ready(); const entries = Reflect.get(e.runtime, 'entries') as Map<string, unknown>;
  for (let n = 0; n < 64; n++) entries.set('retained-' + n, { digest: 'f'.repeat(64), starting: false });
  const getter = vi.fn(() => performance.now() + 5000); const budget = Object.defineProperty({}, 'deadline', { get: getter }) as { deadline: number };
  await expect(e.runtime.retire(e.producer, budget)).rejects.toMatchObject({ reason: 'capacity' });
  expect(getter).not.toHaveBeenCalled(); expect(e.docker.calls).toHaveLength(0);
});
