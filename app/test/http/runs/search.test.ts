import { afterEach, expect, it } from 'vitest';
import { encodeRunListCursor } from '@beetle/contracts/api';
import { runValue } from '../../application/runs/fixture.js';
import { fixture } from './fixture.js';
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
it('normalizes exact search fields and rejects invalid or mismatched semantics before reader work', async () => {
  const f = setup(); const headers = await f.paired();
  const valid = await f.server.inject({ url: f.base + '?limit=1&name=' + encodeURIComponent(' ＡＢＣ '), headers });
  expect(valid.statusCode).toBe(200); expect(f.listRuns).toHaveBeenCalledWith({ scope: f.body.scope, limit: 1, order: 'newest', name: 'abc' });
  const prefix = await f.server.inject({ url: f.base + '?limit=1&runIdPrefix=00000000', headers });
  expect(prefix.statusCode).toBe(200);
  for (const query of ['name=%00abc', 'runIdPrefix=12345678a', 'name=' + encodeURIComponent('界'.repeat(22))]) {
    const response = await f.server.inject({ url: f.base + '?limit=1&' + query, headers });
    expect(response.statusCode).toBe(422); expect(response.json().code).toBe('invalid_value');
  }
  for (const query of ['name=ab', 'runIdPrefix=abcdefgh', 'name=abc&name=def', 'runIdPrefix=00000000&runIdPrefix=11111111', 'name=abc&runIdPrefix=00000000']) {
    expect((await f.server.inject({ url: f.base + '?limit=1&' + query, headers })).statusCode).toBe(400);
  }
  const cursor = encodeRunListCursor({ scope: f.body.scope, query: { limit: 1, order: 'newest', name: 'abc' }, requestedAt: runValue().requestedAt, id: runValue().id });
  expect((await f.server.inject({ url: f.base + '?limit=1&name=def&cursor=' + cursor, headers })).statusCode).toBe(422);
  expect(f.listRuns).toHaveBeenCalledTimes(2); expect(f.getRun).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});
