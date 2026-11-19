import { afterEach, expect, it } from 'vitest';
import { otherId, runValue } from '../../application/runs/fixture.js';
import { fixture, host, origin } from './fixture.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(value => value.close())); });
const url = (f: ReturnType<typeof fixture>) => `${f.base}/${runValue().id}/note`;

it('sets a versioned note through one store call with a server edit time and no allocation', async () => {
  const f = setup(); const headers = await f.paired();
  const body = { scope: f.body.scope, requestId: otherId, expectedNoteVersion: 0, note: 'Warm cache' };
  const response = await f.server.inject({ method: 'PATCH', url: url(f), headers, payload: body });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ id: runValue().id, note: 'Note', noteVersion: 1 });
  expect(f.setNote).toHaveBeenCalledTimes(1);
  expect(f.setNote.mock.calls[0]![0]).toMatchObject({ kind: 'setRunNote', id: runValue().id, request: body, updatedAt: '2026-11-10T00:00:00.000Z' });
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
});

it('rejects auth, scope, shape and size failures before storage', async () => {
  const f = setup(); const headers = await f.paired();
  const request = { scope: f.body.scope, requestId: otherId, expectedNoteVersion: 0, note: 'Warm cache' };
  const denied = await f.server.inject({ method: 'PATCH', url: url(f),
    headers: { host, origin, 'content-type': 'application/json' }, payload: '{invalid' });
  expect(denied.statusCode).toBe(401);
  for (const [payload, status] of [
    [{ ...request, scope: { ...request.scope, workspaceId: otherId } }, 404],
    [{ ...request, note: 'x'.repeat(1001) }, 400], [{ ...request, note: '' }, 400],
    [{ scope: request.scope, requestId: otherId, note: 'No version' }, 400],
    [{ ...request, padding: 'x'.repeat(65536) }, 413],
  ] as const) {
    const response = await f.server.inject({ method: 'PATCH', url: url(f), headers, payload });
    expect(response.statusCode).toBe(status);
  }
  expect(f.setNote).not.toHaveBeenCalled();
});

it('refuses a store result bound to another run or without a written note version', async () => {
  const f = setup(); const headers = await f.paired();
  for (const value of [{ ...runValue(), id: otherId, noteVersion: 1 }, { ...runValue(), noteVersion: 0 }]) {
    f.setNote.mockResolvedValueOnce(value);
    const response = await f.server.inject({ method: 'PATCH', url: url(f), headers,
      payload: { scope: f.body.scope, requestId: otherId, expectedNoteVersion: 0, note: null } });
    expect(response.statusCode).not.toBe(200);
  }
});
