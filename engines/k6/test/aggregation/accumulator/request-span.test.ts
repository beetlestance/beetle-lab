import { expect, it } from 'vitest';
import { marker, point, setup, signal } from './fixtures.js';

it('captures the earliest execute dispatch and latest HTTP completion regardless of arrival order', async () => {
  const { accumulator, feed } = setup();
  await feed(marker());
  await feed(point('beetle_requests', 1, 2400));
  await feed(point('http_req_duration', 9, 2600));
  await feed(point('http_req_duration', 5, 2200));
  await feed(point('beetle_requests', 1, 2000));
  const snapshot = await accumulator.finish(signal());
  expect(snapshot.requestSpan).toEqual({ firstDispatchMs: 2000, lastCompletionMs: 2600 });
  expect(Object.isFrozen(snapshot.requestSpan)).toBe(true);
});

it.each([
  [point('beetle_requests', 1, 2100)],
  [point('http_req_duration', 9, 1900)],
  [point('http_req_duration', 9, 2100, { request: 'r1' })],
  [point('http_req_duration', 9, 2100), point('beetle_requests', 0, 2050)],
])('withholds a span when dispatch and completion evidence cannot agree', async (...extra) => {
  const { accumulator, feed } = setup();
  await feed(marker());
  await feed(point('beetle_requests', 1, 2000));
  for (const value of extra) await feed(value);
  expect((await accumulator.finish(signal())).requestSpan).toBeUndefined();
});
