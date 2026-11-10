import { expect, it } from 'vitest';
import { fixture } from './fixtures.js';

const f = fixture();
it('refuses a fresh original durably and returns the same refusal to a late normal PUT', async () => {
  const e = await f.server();
  const response = await e.server.inject({ method: 'POST', url: `${e.path}/cancel-original`,
    headers: e.headers, payload: e.job });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ cancelRequested: true,
    admission: { state: 'rejected', reason: 'cancelled' } });
  expect(e.enqueue).not.toHaveBeenCalled(); expect(e.cancelOriginal).toHaveBeenCalledTimes(1);
  // This fixture's enqueue only persists the canonical original, without a scheduler.
  const late = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers, payload: e.job });
  expect(late.statusCode).toBe(202); expect(late.json()).toEqual(response.json());
});

it('authenticates and checks scope/generation before any cancellation service effect', async () => {
  const e = await f.server();
  for (const [headers, payload, status] of [
    [{ ...e.headers, authorization: 'Bearer invalid' }, e.job, 401],
    [{ ...e.headers, 'x-beetle-generation': '2' }, e.job, 409],
    [e.headers, { ...e.job, workspaceId: '00000000-0000-4000-8000-000000000099' }, 409],
  ] as const) {
    const response = await e.server.inject({ method: 'POST', url: `${e.path}/cancel-original`, headers, payload });
    expect(response.statusCode).toBe(status);
  }
  expect(e.cancelOriginal).not.toHaveBeenCalled(); expect(e.enqueue).not.toHaveBeenCalled();
});

it('uses the same maximum Offer envelope and refuses overflow before service effects', async () => {
  const e = await f.server(); const text = JSON.stringify(e.job);
  const payload = text + ' '.repeat(2_097_152 - Buffer.byteLength(text));
  const options = { method: 'POST' as const, url: `${e.path}/cancel-original`,
    headers: { ...e.headers, 'content-type': 'application/json' } };
  expect((await e.server.inject({ ...options, payload: payload + ' ' })).statusCode).toBe(413);
  expect(e.cancelOriginal).not.toHaveBeenCalled();
  expect((await e.server.inject({ ...options, payload })).statusCode).toBe(200);
  expect(e.cancelOriginal).toHaveBeenCalledTimes(1); expect(e.enqueue).not.toHaveBeenCalled();
});
