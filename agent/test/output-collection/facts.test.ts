import { expect, it } from 'vitest';
import { OUTPUT_CUSTODY_BYTES } from '../../src/collection/output/index.js';
import { deferred, fixture, tracking } from './fixture.js';
const f = fixture();

it('publishes owned exact raw-result/control/root facts after successful native closes', async () => {
  const artifact = await f.artifact('report.bin', 'native bytes');
  const result = f.result([artifact]); await f.write(result);
  const expected = await f.custody(); const t = tracking();
  const operation = f.collect(f.options(result), t.ports); const outcome = await operation.result;
  expect(outcome).toMatchObject({ ok: true, custody: expected });
  if (!outcome.ok) throw new Error('Expected successful native collection');
  expect(outcome.verifiedBytes).toBe(expected.resultFileBytes + expected.controlBytes + artifact.bytes);
  expect(t.closed.length).toBe(t.opened.length);
  expect(Object.isFrozen(outcome.custody)).toBe(true); expect(Object.isFrozen(outcome.custody.root)).toBe(true);
  expect(Reflect.set(outcome.custody.root, 'inode', 'changed')).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(outcome.custody))).toBeLessThanOrEqual(OUTPUT_CUSTODY_BYTES);
  await operation.quiesced;
});
it('distinguishes a valid one-MiB raw result from its much smaller sealed canonical content', async () => {
  const result = f.result(); const canonical = JSON.stringify(result);
  expect(Buffer.byteLength(canonical)).toBeLessThan(65_536);
  await f.write(canonical + ' '.repeat(1_048_576 - Buffer.byteLength(canonical)));
  const outcome = await f.collect(f.options(result, { controlBytes: 7, outputBytes: 1_048_583 })).result;
  expect(outcome).toMatchObject({ ok: true, value: result, verifiedBytes: 1_048_583,
    custody: { resultFileBytes: 1_048_576, controlBytes: 7 } });
  expect(await f.collect(f.options(result, { controlBytes: 7, outputBytes: 1_048_582 })).result)
    .toEqual({ ok: false, reason: 'output_limit' });
});
it('does not expose successful custody while an original root close is pending', async () => {
  const result = f.result(); await f.write(result);
  const entered = deferred<void>(); const released = deferred<void>();
  const t = tracking({ close: async path => {
    if (path === f.directory()) { entered.resolve(); await released.promise; }
  } });
  const operation = f.collect(f.options(result), t.ports);
  let settled = false; void operation.result.then(() => { settled = true; });
  try {
    await entered.promise; expect(settled).toBe(false);
    released.resolve(); expect(await operation.result).toMatchObject({ ok: true, custody: await f.custody() });
  } finally { released.resolve(); }
});
it('does not return successful custody after an original descriptor-close failure', async () => {
  const result = f.result(); await f.write(result);
  const t = tracking({ closeDone: path => { if (path === f.directory()) throw new Error('Owned close failure'); } });
  const operation = f.collect(f.options(result), t.ports);
  expect(await operation.result).toEqual({ ok: false, reason: 'io' });
  await expect(operation.close()).rejects.toThrow(); await operation.quiesced;
});
