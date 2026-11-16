import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeResponse, archive, id, transportFixture } from './mailbox-fixtures.js';

let now = 0;
beforeEach(() => {now = 0; vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => now);});
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});
it('holds the exposed original until both HTTP request and response close', async () => {
  const f = transportFixture(); const original = f.transport.readMailboxArchive({containerId: id, deadline: 1000});
  let settled = false; void original.then(() => {settled = true;});
  const response = f.requests[0]!.respond(archive()); await Promise.resolve(); expect(settled).toBe(false);
  f.requests[0]!.emit('close'); await Promise.resolve(); expect(settled).toBe(false);
  response.emit('close'); expect(await original).toMatchObject({ok: true, status: 200});
  expect(f.paths[0]).toMatchObject({path: `/v1.47/containers/${id}/archive?path=%2Fbeetle%2Flive%2Flive-metrics.mailbox`, agent: false, maxHeaderSize: 16384});
});
it('retains two ordinary slots through cancellation and a late response; no queued replacement', async () => {
  const f = transportFixture(); const controller = new AbortController();
  const first = f.transport.readMailboxArchive({containerId: id, deadline: 1000, signal: controller.signal});
  const second = f.transport.readMailboxArchive({containerId: id, deadline: 1000}); controller.abort();
  expect(await f.transport.readMailboxArchive({containerId: id, deadline: 1000})).toMatchObject({ok: false, reason: 'overflow'});
  const late = new FakeResponse(); f.requests[0]!.emit('response', late); expect(late.destroyed).toBe(true);
  f.requests[0]!.emit('close'); await Promise.resolve();
  expect(await f.transport.readMailboxArchive({containerId: id, deadline: 1000})).toMatchObject({reason: 'overflow'});
  late.emit('close'); expect(await first).toMatchObject({ok: false, reason: 'aborted'});
  f.requests[1]!.emit('close'); expect(await second).toMatchObject({ok: false, reason: 'unavailable'});
  expect(f.requests).toHaveLength(2);
});
it('expires a read but retains its original and slot until physical close', async () => {
  const f = transportFixture(); const first = f.transport.readMailboxArchive({containerId: id, deadline: 10});
  let settled = false; void first.then(() => {settled = true;}); now = 10; await vi.advanceTimersByTimeAsync(10);
  expect(f.requests[0]!.destroyed).toBe(true); expect(settled).toBe(false);
  f.requests[0]!.emit('close'); expect(await first).toMatchObject({ok: false, reason: 'deadline'});
});
it('rejects actual byte overflow independently of absent or dishonest size metadata', async () => {
  const f = transportFixture(); const original = f.transport.readMailboxArchive({containerId: id, deadline: 1000});
  const response = f.requests[0]!.respond(new Uint8Array(98305)); expect(response.destroyed).toBe(true);
  response.emit('close'); f.requests[0]!.emit('close'); expect(await original).toMatchObject({reason: 'response_limit'});
});
it('captures synchronous abort during request construction before releasing its native owner', async () => {
  const controller = new AbortController(); const f = transportFixture(() => controller.abort());
  const original = f.transport.readMailboxArchive({containerId: id, deadline: 1000, signal: controller.signal});
  expect(f.requests[0]!.ended).toBe(false); expect(f.requests[0]!.destroyed).toBe(true);
  f.requests[0]!.emit('close'); expect(await original).toMatchObject({reason: 'aborted', dispatched: false});
});
it('rejects invalid identifiers and aborted callers before creating native work', async () => {
  const f = transportFixture();
  expect(await f.transport.readMailboxArchive({containerId: '../bad', deadline: 1000})).toMatchObject({reason: 'invalid_input'});
  expect(await f.transport.readMailboxArchive({containerId: id, deadline: 1000, signal: AbortSignal.abort()})).toMatchObject({reason: 'aborted'});
  expect(await f.transport.readMailboxArchive({containerId: id, deadline: 1000, signal: {} as AbortSignal})).toMatchObject({reason: 'invalid_input'});
  expect(f.requests).toHaveLength(0);
});
it('does not dispatch after the deadline expires during native request construction', async () => {
  const f = transportFixture(() => {now = 1001;});
  const original = f.transport.readMailboxArchive({containerId: id, deadline: 1000});
  expect(f.requests[0]!.ended).toBe(false); expect(f.requests[0]!.destroyed).toBe(true);
  f.requests[0]!.emit('close'); expect(await original).toMatchObject({reason: 'deadline', dispatched: false});
});
