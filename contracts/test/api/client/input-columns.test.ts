import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';
it('serializes a closed kind query without pagination and binds response scope, input and parser', async () => {
  const record = await load('input', 'InputRecord');
  const route = { ...params, inputId: record.id };
  const value = {
    scope: record.scope,
    inputId: record.id,
    sha256: record.sha256,
    bytes: record.bytes,
    kind: 'csv' as const,
    columns: ['b', 'a'],
  };
  const fetcher = reply(value);
  const client = createApiClient({ baseUrl, fetch: fetcher });
  expect(await client.getInputColumns({ params: route, query: { kind: 'csv' } })).toEqual({ ok: true, value });
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    `https://api.invalid/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/inputs/${record.id}/columns?kind=csv`,
  );
  for (const invalid of [
    { ...value, inputId: otherId },
    { ...value, scope: { ...value.scope, workspaceId: otherId } },
    { ...value, kind: 'json' },
    { ...value, columns: ['id', 'id'] },
    { ...value, columns: ['constructor'] },
  ])
    expect(
      await createApiClient({ baseUrl, fetch: reply(invalid) }).getInputColumns({
        params: route,
        query: { kind: 'csv' },
      }),
    ).toMatchObject({ ok: false, error: { kind: 'response' } });
  const sorted = { ...value, kind: 'json' as const, columns: ['a', 'b'] };
  expect(
    (
      await createApiClient({ baseUrl, fetch: reply(sorted) }).getInputColumns({
        params: route,
        query: { kind: 'json' },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await createApiClient({ baseUrl, fetch: reply({ ...sorted, columns: ['b', 'a'] }) }).getInputColumns({
        params: route,
        query: { kind: 'json' },
      })
    ).ok,
  ).toBe(false);
});
it('accepts explicit unknown discovery and refuses unsafe names and an absent kind', () => {
  const columns = {
    scope: { kind: 'workspace', ...params },
    inputId: otherId,
    sha256: 'a'.repeat(64),
    bytes: 0,
    kind: 'csv',
    columns: null,
  };
  expect(validateApi('InputColumns', columns).ok).toBe(true);
  for (const names of [
    [],
    ['prototype'],
    ['__proto__'],
    ['unsafe.name'],
    ['a'.repeat(65)],
    Array.from({ length: 65 }, (_, index) => 'col' + index),
  ])
    expect(validateApi('InputColumns', { ...columns, columns: names }).ok).toBe(false);
  expect(validateApi('InputColumnsQuery', {}).ok).toBe(false);
  expect(validateApi('InputColumnsQuery', { kind: 'csv', limit: 1 }).ok).toBe(false);
});
