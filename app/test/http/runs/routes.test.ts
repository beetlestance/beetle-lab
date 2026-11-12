import { afterEach, expect, it } from 'vitest';
import { encodeRunListCursor } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { deferred, otherId, runValue } from '../../application/runs/fixture.js';
import { fixture, host } from './fixture.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(value => value.close())); });

it('returns 202 only after the store settles with original receipt IDs and invokes two IDs/one clock', async () => {
  const f = setup(); const headers = await f.paired(); const held = deferred<Run>();
  const entered = deferred<void>();
  f.execute.mockImplementationOnce(async () => { entered.resolve(); return held.promise; });
  let settled = false;
  const pending = f.server.inject({ method: 'POST', url: f.base, headers, payload: f.body })
    .then(response => { settled = true; return response; });
  await entered.promise; expect(settled).toBe(false);
  held.resolve(runValue()); const response = await pending;
  expect(response.statusCode).toBe(202); expect(response.json()).toEqual(runValue());
  expect(f.execute).toHaveBeenCalledTimes(1); expect(f.newId).toHaveBeenCalledTimes(2);
  expect(f.now).toHaveBeenCalledTimes(1);
  expect(f.execute.mock.calls[0]![0]).toMatchObject({ kind: 'createRun', request: f.body,
    id: '00000000-0000-4000-8000-000000000007', attemptId: '00000000-0000-4000-8000-000000000008',
    requestedAt: '2026-11-10T00:00:00.000Z' });
  const replay = await f.server.inject({ method: 'POST', url: f.base, headers, payload: f.body });
  expect(replay.statusCode).toBe(202); expect(replay.json()).toEqual(response.json());
  expect(f.newId).toHaveBeenCalledTimes(4); expect(f.now).toHaveBeenCalledTimes(2);
});

it('reads scoped history/detail without allocation and decodes strict page queries', async () => {
  const f = setup(); const paired = await f.paired(); const headers = { host, cookie: paired.cookie };
  const cursor = encodeRunListCursor({ scope: f.body.scope, query: { limit: 1, order: 'newest' }, requestedAt: runValue().requestedAt, id: otherId });
  const page = await f.server.inject({ url: `${f.base}?limit=1&cursor=${cursor}`, headers });
  expect(page.statusCode).toBe(200); expect(page.json().items).toEqual([runValue()]);
  expect(f.listRuns).toHaveBeenCalledWith({ scope: f.body.scope, limit: 1, cursor, order: 'newest' });
  const detail = await f.server.inject({ url: `${f.base}/${runValue().id}`, headers });
  expect(detail.statusCode).toBe(200); expect(detail.json()).toEqual(runValue());
  expect(f.getRun).toHaveBeenCalledWith({ scope: f.body.scope, id: runValue().id });
  for (const query of ['', '?limit=0', '?limit=101', '?limit=01', '?limit=1&limit=2',
    '?limit=1&cursor=bad/path', '?limit=1&extra=1',
    '?limit=1&state=queued&state=active', '?limit=1&outcome=passed&outcome=failed',
    '?limit=1&order=newest&order=oldest', '?limit=1&state=bogus', '?limit=1&outcome=unknown', '?limit=1&order=NEWEST']) {
    expect((await f.server.inject({ url: `${f.base}${query}`, headers })).statusCode).toBe(400);
  }
  for (const query of ['?limit=1&cursor=opaque_A', '?limit=1&order=oldest&cursor=' + cursor]) {
    const rejected = await f.server.inject({ url: f.base + query, headers });
    expect(rejected.statusCode).toBe(422); expect(rejected.json().code).toBe('invalid_value');
  }
  expect(f.listRuns).toHaveBeenCalledTimes(1);
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

it('fails invalid repository output and uncertain mutation failure without success or automatic retry', async () => {
  const f = setup(); const headers = await f.paired();
  f.execute.mockResolvedValueOnce({ ...runValue(), revisionId: otherId });
  const wrong = await f.server.inject({ method: 'POST', url: f.base, headers, payload: f.body });
  expect(wrong.statusCode).toBe(500); expect(wrong.json().code).toBe('internal_error');
  f.execute.mockRejectedValueOnce(new Error('uncertain synthetic write'));
  expect((await f.server.inject({ method: 'POST', url: f.base, headers, payload: f.body })).statusCode).toBe(500);
  expect(f.execute).toHaveBeenCalledTimes(2);
  f.getRun.mockResolvedValueOnce({ ...runValue(), id: otherId });
  expect((await f.server.inject({ url: `${f.base}/${runValue().id}`, headers })).statusCode).toBe(404);
  f.listRuns.mockResolvedValueOnce({ scope: f.body.scope, items: [runValue(), runValue()], nextCursor: null });
  expect((await f.server.inject({ url: `${f.base}?limit=2`, headers })).statusCode).toBe(500);
});

it('decodes exact run filters and direction while preserving read-only behavior', async () => {
  const f = setup(); const headers = await f.paired();
  const response = await f.server.inject({ url: f.base + '?limit=2&state=queued&outcome=pending&order=oldest', headers });
  expect(response.statusCode).toBe(200);
  expect(f.listRuns).toHaveBeenCalledWith({ scope: f.body.scope, limit: 2, state: 'queued', outcome: 'pending', order: 'oldest' });
  f.listRuns.mockResolvedValueOnce({ scope: f.body.scope, items: [runValue()], nextCursor: null });
  expect((await f.server.inject({ url: f.base + '?limit=2&state=active', headers })).statusCode).toBe(500);
  expect(f.execute).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).not.toHaveBeenCalled();
});
