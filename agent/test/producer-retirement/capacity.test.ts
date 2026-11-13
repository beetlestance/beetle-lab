import { expect, it, vi } from 'vitest';
import type { RetirementIntent } from '../../src/retirement-values/index.js';
import { ProducerRetirement } from '../../src/producer-retirement/index.js';
import { deferred } from '../output-transfer/fixtures.js';
import { model, metadata, original } from './coordinator-fixtures.js';
it('reserves all64 entries before Journal/clock callbacks and refuses a65th without effects', async () => {
  const now = vi.fn(() => 100); const e = model({ now });
  const pending: { record: RetirementIntent; release: ReturnType<typeof deferred<RetirementIntent>> }[] = [];
  vi.mocked(e.port.preflight).mockImplementation(async input => {
    const release = deferred<RetirementIntent>(); pending.push({ record: metadata(input), release }); return release.promise;
  });
  const work = Array.from({ length: 64 }, (_, n) => e.coordinator.retire({ ...original,
    attemptId: `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}` }));
  const calls = now.mock.calls.length;
  expect(() => e.coordinator.retire({ ...original, attemptId: '00000000-0000-4000-8000-000000009999' })).toThrow('capacity');
  expect(now).toHaveBeenCalledTimes(calls); expect(e.port.begin).not.toHaveBeenCalled();
  await Promise.resolve(); await Promise.resolve(); expect(pending).toHaveLength(64);
  for (const item of pending) item.release.resolve(item.record);
  expect((await Promise.all(work.map(item => item.result))).every(item => item.ok)).toBe(true);
  await Promise.all(work.map(item => item.settled)); expect(e.coordinator.status().retained).toBe(0); await e.coordinator.close();
});
it('keeps one coordinator owner per physical Journal port and rejects invalid budget configuration', async () => {
  const e = model(); expect(() => new ProducerRetirement({ journal: e.port, gate: e.gate, installation: e.installation })).toThrow('capacity');
  expect(() => model({ budgetMs: 30001 })).toThrow('invalid_input'); await e.coordinator.close();
});
it('keeps reentrant clock callbacks from issuing a second cycle during a settled retry', async () => {
  let reenter = false; const callback = vi.fn();
  const e = model({ now: () => { if (reenter) { reenter = false; callback(); } return 100; } });
  vi.mocked(e.installation.retireOutput).mockRejectedValueOnce(new Error('retryable stopped inspection'));
  const first = e.coordinator.retire(original); expect((await first.result).ok).toBe(false); await first.settled;
  callback.mockImplementation(() => { expect(() => e.coordinator.retire(original)).toThrow('capacity'); }); reenter = true;
  const next = e.coordinator.retire(original); expect((await next.result).ok).toBe(true); await next.settled; await e.coordinator.close();
});
