import { expect, it, vi } from 'vitest';
import { ProducerRetirement, producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { gateFor } from '../producer-gate/fixtures.js';
import { retirementFixture } from '../retirement/fixtures.js';
import { deferred } from '../output-transfer/fixtures.js';
const f = retirementFixture();
async function compose(journal: Awaited<ReturnType<typeof f.open>>) {
  const namespace = await journal.stagingNamespace.read(); if (namespace?.state !== 'bound') throw new Error('Missing namespace');
  const gate = gateFor(journal, namespace.anchor.namespaceIdentity); const installation = { retireOutput: vi.fn(async () => {}) };
  return { gate, installation, coordinator: new ProducerRetirement({ journal: journal.retirements, gate, installation }) };
}
it('uses the actual compiled Journal transaction and scopes the resulting producer-only capability', async () => {
  const e = await f.ready(); const c = await compose(e.journal); const work = c.coordinator.retire(e.request);
  const result = await work.result; await work.settled; if (!result.ok) throw new Error('Missing producer barrier');
  expect(producerBarrierFacts(result.value).intent).toEqual(await e.journal.retirements.read(e.key));
  expect(await e.journal.retirements.isOpen(e.key)).toBe(false); expect(c.installation.retireOutput).toHaveBeenCalledTimes(1);
  const conflict = c.coordinator.retire({ ...e.request, deletionId: e.request.runId });
  expect(await conflict.result).toEqual({ ok: false, reason: 'conflict' }); await conflict.settled;
  await c.coordinator.close();
});
it('keeps lost committed begin reply fenced through actual worker termination, then reopens the exact durable intent', async () => {
  const e = await f.ready(); const c = await compose(e.journal);
  const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  const id = Number(Reflect.get(e.journal, 'nextId')) + 2; const committed = deferred<void>();
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id && Reflect.get(reply, 'ok') === true) { committed.resolve(); return; }
    receive.call(e.journal, reply);
  });
  const work = c.coordinator.retire(e.request); await committed.promise;
  expect(c.installation.retireOutput).not.toHaveBeenCalled(); expect(() => c.gate.acquire(e.key)).toThrow('retired');
  await e.journal.abort(); expect((await work.result).ok).toBe(false); await work.settled;
  await expect(c.coordinator.close()).rejects.toThrow('cleanup');
  const reopened = await f.open(e.path); const next = await compose(reopened); const replay = next.coordinator.retire(e.request);
  const result = await replay.result; await replay.settled; expect(result.ok).toBe(true);
  expect(next.installation.retireOutput).toHaveBeenCalledTimes(1); await next.coordinator.close();
});
