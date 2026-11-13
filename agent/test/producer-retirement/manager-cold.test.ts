import * as budgets from '../../src/installation/budget.js';
import type { Manager } from '../../src/installation/manager.js';
import { entries } from '../installation/delivery-fixtures.js';
import { deferred } from '../output-transfer/fixtures.js';
import { expect, it, vi } from 'vitest';
import { fixture, scope, operation } from '../installation/fixtures.js';
import { requestFor } from './fixtures.js';
const f = fixture();
async function completed() {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager); await e.finish(manager);
  const key = scope(e.offer); const proof = await e.owner.readOutputAbsence(key); if (!proof) throw new Error('Missing actual absence closure');
  await e.owner.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: proof.finalAgentSeq });
  const intent = await e.owner.retirements.begin(requestFor(proof)); return { ...e, manager, key, proof, intent };
}
it.each(['created', 'exited', 'missing'] as const)('inspects exact current %s runtime read-only after completed real controller retirement', async state => {
  const e = await completed(); e.backend.observation = state === 'missing' ? { state: 'missing' } : e.backend.known(state).value;
  const before = await e.owner.get(e.key); const counters = [e.backend.creates, e.backend.starts, e.backend.stops.length, e.backend.kills];
  const inspect = vi.spyOn(e.backend, 'inspect'); const append = vi.spyOn(e.owner, 'appendSupervisor'); const supervision = vi.spyOn(e.owner, 'supervision');
  await e.manager.retireOutput(e.intent, operation());
  expect(inspect).toHaveBeenCalledTimes(1); expect(append).not.toHaveBeenCalled(); expect(supervision).not.toHaveBeenCalled();
  expect([e.backend.creates, e.backend.starts, e.backend.stops.length, e.backend.kills]).toEqual(counters);
  expect(await e.owner.get(e.key)).toEqual(before); expect(entries(e.manager as Manager).size).toBe(0);
});
it.each(['running', 'unknown', 'wrong_id', 'restarting'] as const)('keeps cold %s unresolved and requires a fresh stopped inspection for retry', async state => {
  const e = await completed(); e.backend.observation = state === 'wrong_id'
    ? { ...e.backend.known('exited').value, id: 'f'.repeat(64) } : e.backend.known(state === 'unknown' ? 'unknown' : state).value;
  const inspect = vi.spyOn(e.backend, 'inspect'); const creates = e.backend.creates; const starts = e.backend.starts;
  await expect(e.manager.retireOutput(e.intent, operation())).rejects.toMatchObject({ code: 'backend_unavailable' });
  expect(entries(e.manager as Manager).size).toBe(0); expect(e.backend.creates).toBe(creates); expect(e.backend.starts).toBe(starts);
  e.backend.observation = e.backend.known('exited').value; await e.manager.retireOutput(e.intent, operation());
  expect(inspect).toHaveBeenCalledTimes(2); expect(await e.owner.readOutputAbsence(e.key)).toEqual(e.proof);
});

it('does not issue later cold reservation/Offer/inspect calls after a held Supervisor snapshot exceeds its budget', async () => {
  const e = await completed(); const abort = new AbortController(); const entered = deferred<void>(); const release = deferred<void>();
  const get = e.owner.get.bind(e.owner); let reads = 0;
  const snapshot = vi.spyOn(e.owner, 'get').mockImplementation(async key => {
    const value = await get(key); if (++reads === 2) { entered.resolve(); await release.promise; } return value;
  });
  const reservation = vi.spyOn(e.owner, 'admission'); const offer = vi.spyOn(e.owner, 'readOffer'); const inspect = vi.spyOn(e.backend, 'inspect');
  const work = e.manager.retireOutput(e.intent, { ...operation(), signal: abort.signal }); void work.catch(() => undefined);
  try {
    await entered.promise; abort.abort(); release.resolve(); await expect(work).rejects.toMatchObject({ code: 'backend_unavailable' });
    expect(reservation).toHaveBeenCalledTimes(1); expect(offer).toHaveBeenCalledTimes(1); expect(inspect).not.toHaveBeenCalled();
  } finally { release.resolve(); await Promise.allSettled([work]); snapshot.mockRestore(); }
});

it('checks the owner again when a close is queued between helper settlement and caller continuation', async () => {
  const e = await completed(); const abort = new AbortController(); const check = budgets.checkBudget; let helperChecks = 0; let injected = false;
  const offer = vi.spyOn(e.owner, 'readOffer');
  const guard = vi.spyOn(budgets, 'checkBudget').mockImplementation(operation => {
    check(operation);
    if (new Error().stack?.includes('releasedOwnership') && ++helperChecks === 2) {
      injected = true; queueMicrotask(() => abort.abort());
    }
  });
  try {
    await expect(e.manager.retireOutput(e.intent, { ...operation(), signal: abort.signal })).rejects.toMatchObject({ reason: 'closed' });
    expect(injected).toBe(true); expect(offer).not.toHaveBeenCalled();
  } finally { guard.mockRestore(); }
});
