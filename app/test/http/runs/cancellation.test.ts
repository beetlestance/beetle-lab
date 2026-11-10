import { afterEach, expect, it } from 'vitest';
import type { Run } from '@beetle/contracts/api';
import { deferred, otherId, runValue } from '../../application/runs/fixture.js';
import { fixture, host, origin } from './fixture.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(value => value.close())); });

it('accepts scoped cancellation only after its durable store original settles', async () => {
  const f = setup(); const headers = await f.paired(); const held = deferred<Run>();
  const entered = deferred<void>();
  f.cancel.mockImplementation(async () => { entered.resolve(); return held.promise; });
  const body = { scope: f.body.scope, requestId: otherId }; let settled = false;
  const pending = f.server.inject({ method: 'POST', url: `${f.base}/${runValue().id}/cancel`, headers, payload: body })
    .then(response => { settled = true; return response; });
  await entered.promise; expect(settled).toBe(false);
  const stopping = { ...runValue(), version: 2, cancellationRequested: true }; held.resolve(stopping);
  const response = await pending;
  expect(response.statusCode).toBe(202); expect(response.json()).toEqual(stopping);
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.cancel.mock.calls[0]![0]).toMatchObject({ kind: 'cancelRun', id: stopping.id, request: body });
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

it('rejects session/CSRF failures before parsing cancellation or accessing storage', async () => {
  const f = setup(); const headers = await f.paired();
  for (const [denied, status] of [[{ host, origin }, 401],
    [{ ...headers, 'x-beetle-csrf': '' }, 403], [{ ...headers, origin: 'http://other.invalid' }, 403]] as const) {
    const response = await f.server.inject({ method: 'POST', url: `${f.base}/${runValue().id}/cancel`,
      headers: { ...denied, 'content-type': 'application/json' }, payload: '{invalid' });
    expect(response.statusCode).toBe(status); expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(f.cancel).not.toHaveBeenCalled();
});

it('rejects mismatched scope, extra fields and oversized bodies before storage effects', async () => {
  const f = setup(); const headers = await f.paired();
  const request = { scope: f.body.scope, requestId: otherId };
  for (const [payload, status] of [
    [{ ...request, scope: { ...request.scope, workspaceId: otherId } }, 404],
    [{ ...request, force: true }, 400], [{ ...request, padding: 'x'.repeat(65536) }, 413],
  ] as const) {
    const response = await f.server.inject({ method: 'POST', url: `${f.base}/${runValue().id}/cancel`, headers, payload });
    expect(response.statusCode).toBe(status);
  }
  expect(f.cancel).not.toHaveBeenCalled();
});

it('rejects unaccepted nonterminal or unrelated run receipts instead of reporting success', async () => {
  const f = setup(); const headers = await f.paired();
  for (const value of [runValue(), { ...runValue(), id: otherId, cancellationRequested: true }]) {
    f.cancel.mockResolvedValueOnce(value);
    const response = await f.server.inject({ method: 'POST', url: `${f.base}/${runValue().id}/cancel`, headers,
      payload: { scope: f.body.scope, requestId: otherId } });
    expect(response.statusCode).not.toBe(202);
  }
});
