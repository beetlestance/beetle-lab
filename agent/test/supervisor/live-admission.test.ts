import { expect, it } from 'vitest';
import { AttemptLiveMetrics } from '../../src/supervisor/live.js';
import { SamplingAdmission } from '../../src/telemetry/index.js';
import type { MailboxArchiveReply } from '../../src/backends/docker/index.js';
import { frame, image } from '../live-metrics/fixtures.js';
import { ControlledBackend, deferred, supervisorFixture } from './fixtures.js';
const f = supervisorFixture();
it('shares two original telemetry slots and retains both after ignored abort', async () => {
  const e = await f.setup(); const admission = new SamplingAdmission();
  const gate = deferred<MailboxArchiveReply>(); let calls = 0;
  const value = frame({scope: e.input.key, capturedAtMs: e.time.wall(), publishedAtMs: e.time.wall(),
    startTimeMs: e.time.wall() - 1000, endTimeMs: e.time.wall()});
  const backend = Object.assign(new ControlledBackend(), {readMailbox: () => {calls++; return gate.promise;}});
  const make = () => {
    const live = new AttemptLiveMetrics({input: e.input, backend, clock: e.time, admission,
      approve: () => ({scope: value.scope, producerEpoch: value.producerEpoch, subset: value.subset})});
    live.approve(e.offer); return live;
  };
  const first = make(); const second = make(); const third = make();
  const operation = {deadline: e.time.monotonic() + 5000};
  const one = first.read(operation); const two = second.read(operation);
  await expect.poll(() => calls).toBe(2);
  expect(await third.read(operation)).toEqual({ok: false, reason: 'busy'});
  const closing = first.close(); expect(first.pending).toBe(true);
  expect(await third.read(operation)).toEqual({ok: false, reason: 'busy'});
  gate.resolve({ok: true, status: 200, image: image(value)});
  expect(await one).toEqual({ok: false, reason: 'closed'}); expect((await two).ok).toBe(true); await closing;
  expect((await third.read(operation)).ok).toBe(true);
  await Promise.all([second.close(), third.close()]);
});
