import { expect, it } from 'vitest';
import { createApiClient, encodeRunListCursor } from '../../../src/api/index.js';
import { baseUrl, load, params, reply } from './helpers.js';
it('serializes normalized literal search and binds continuation before fetch', async () => {
  const page = await load('run-page', 'RunPage'); const fetcher = reply(page);
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect((await client.listRuns({ params, query: { limit: 10, name: '  ＡＢＣ%_' } })).ok).toBe(true);
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.searchParams.get('name')).toBe('abc%_');
  const cursor = encodeRunListCursor({ scope: page.scope, query: { limit: 10, order: 'newest', name: 'abc' }, requestedAt: page.items[0]!.requestedAt, id: page.items[0]!.id });
  for (const query of [{ limit: 10, name: 'ab' }, { limit: 10, name: 'xyz', cursor },
    { limit: 10, name: 'abc', runIdPrefix: '00000000' }, { limit: 10, runIdPrefix: 'abcdefgh' }]) {
    expect(await client.listRuns({ params, query })).toEqual({ ok: false, error: { kind: 'request' } });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects a returned run that does not match the requested UUID prefix', async () => {
  const page = await load('run-page', 'RunPage');
  const client = createApiClient({ baseUrl, fetch: reply(page) });
  expect(await client.listRuns({ params, query: { limit: 10, runIdPrefix: 'ffffffff' } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});
