import { expect, it, vi } from 'vitest';
import { deferred, flush, harness } from './fixtures.js';

const termOrKill = (signals: (NodeJS.Signals | 0)[]) => signals.filter((signal) => signal !== 0);

it('observes clean EOF and keeps the actual cancelled result and collected bytes', async () => {
  const sink = vi.fn(async () => {});
  const h = harness({ sink });
  const result = h.actor.run();
  await flush();
  h.child.start();
  h.actor.cancelAndDrain();
  h.actor.cancelAndDrain();
  const eof = new Promise<void>((resolve) => h.child.stdout.once('end', resolve));
  h.child.stdout.end(Buffer.from('complete stream'));
  h.child.stderr.end();
  await expect.poll(() => sink.mock.calls.length).toBe(1);
  await eof;
  h.absent();
  h.child.end(105);
  h.child.finish();
  await expect(result).resolves.toMatchObject({
    cause: 'cancelled',
    state: 'stopped',
    collection: 'complete',
    metricBytes: 15,
    exitCode: 105,
    quiescent: true,
  });
  expect(termOrKill(h.signals)).toEqual(['SIGTERM']);
  await h.actor.close();
});

it('forces the child down at its original drain limit and acknowledges only actual quiescence', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  let sinkSignal: AbortSignal | undefined;
  const h = harness({
    sink: async (_bytes, delivery) => {
      sinkSignal = delivery.signal;
      await pending.promise;
    },
  });
  const result = h.actor.run();
  await flush();
  h.child.start();
  h.actor.cancelAndDrain();
  h.child.stdout.write(Buffer.from('pending'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(sinkSignal?.aborted).toBe(false);
  h.actor.cancelAndDrain();
  await vi.advanceTimersByTimeAsync(500);
  expect(sinkSignal?.aborted).toBe(true);
  expect(termOrKill(h.signals)).toEqual(['SIGTERM', 'SIGKILL']);
  h.absent();
  h.child.end(null, 'SIGKILL');
  h.child.finish();
  await vi.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toMatchObject({ cause: 'cancelled', collection: 'partial', quiescent: false });
  pending.resolve();
  await h.actor.close();
});

it('hard-fences a drain when its parent aborts', async () => {
  const parent = new AbortController();
  const h = harness({ signal: parent.signal });
  const result = h.actor.run();
  await flush();
  h.child.start();
  h.actor.cancelAndDrain();
  parent.abort();
  expect(h.child.stdout.destroyed).toBe(true);
  h.absent();
  h.child.end(null, 'SIGTERM');
  h.child.finish();
  await expect(result).resolves.toMatchObject({ cause: 'cancelled', collection: 'partial' });
  await h.actor.close();
});

it('refuses the soft path before spawn so the caller can abort the original launch', async () => {
  const parent = new AbortController();
  const h = harness({ signal: parent.signal });
  expect(h.actor.cancelAndDrain()).toBe(false);
  parent.abort();
  await expect(h.actor.run()).resolves.toMatchObject({ state: 'not_started', cause: 'cancelled' });
  expect(h.spawn).not.toHaveBeenCalled();
  await h.actor.close();
});

it('cannot certify EOF past the monotonic cutoff even before the timer fires', async () => {
  vi.useFakeTimers();
  const wall = Date.now();
  let mono = 1000;
  const h = harness({ clock: { wall: () => wall, monotonic: () => mono } });
  const result = h.actor.run();
  await flush();
  h.child.start();
  expect(h.actor.cancelAndDrain()).toBe(true);
  h.child.stdout.end();
  h.child.stderr.end();
  await vi.advanceTimersByTimeAsync(0);
  mono += 1501;
  h.absent();
  h.child.end(105);
  h.child.finish();
  await expect(result).resolves.toMatchObject({ cause: 'cancelled', collection: 'partial' });
  await h.actor.close();
});

it('does not arm new work after TERM synchronously retires its original', async () => {
  vi.useFakeTimers();
  let present = true;
  const h = harness(
    {},
    {
      group: (_pid, signal) => {
        if (signal === 'SIGTERM') {
          present = false;
          h.child.end(105);
          h.child.finish();
        }
        return present ? 'present' : 'absent';
      },
    },
  );
  const result = h.actor.run();
  await flush();
  h.child.start();
  h.child.stdout.end();
  h.child.stderr.end();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.actor.cancelAndDrain()).toBe(true);
  await expect(result).resolves.toMatchObject({ cause: 'cancelled', collection: 'complete' });
  expect(vi.getTimerCount()).toBe(0);
  await h.actor.close();
});

it('retires a late child after the original result already reported unknown', async () => {
  vi.useFakeTimers();
  const hard = new AbortController();
  const h = harness({ signal: hard.signal });
  const result = h.actor.run();
  await flush();
  hard.abort();
  await vi.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toMatchObject({ state: 'unknown', quiescent: false });
  let closed = false;
  const close = h.actor.close().then(() => {
    closed = true;
  });
  h.child.start();
  h.child.end(null, 'SIGTERM');
  h.child.finish();
  await flush();
  expect(closed).toBe(false);
  h.absent();
  await vi.advanceTimersByTimeAsync(25);
  await close;
  expect(closed).toBe(true);
  expect(termOrKill(h.signals)).toEqual(['SIGTERM']);
});
