import { expect, it } from 'vitest';
import { encodeRunListCursor, captureRunListCursor, normalizeRunListQuery, runListPosition, runListPageMatches, validateApi } from '../../src/api/index.js';
import type { Run, RunListQuery } from '../../src/api/index.js';
import { fixture } from './fixtures.js';
const scope = { kind: 'workspace' as const, organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002' };
const id = '00000000-0000-4000-8000-000000000005';
const requestedAt = '2026-11-09T00:00:00.000Z';
const query = normalizeRunListQuery({ limit: 2 });
const cursor = () => encodeRunListCursor({ scope, query, requestedAt, id });
it('normalizes the default without mutating input or schema validation', () => {
  const input = { limit: 2 };
  expect(validateApi('RunListQuery', input).ok).toBe(true); expect(input).toEqual({ limit: 2 });
  expect(normalizeRunListQuery(input)).toEqual({ limit: 2, order: 'newest' });
  expect(normalizeRunListQuery({ ...input, order: 'newest' })).toEqual(query);
});
it('binds the canonical bounded cursor to the entire query and scope', () => {
  const encoded = cursor(); expect(encoded.length).toBeLessThanOrEqual(512);
  expect(captureRunListCursor(encoded)).toEqual({ scope, query, requestedAt, id });
  expect(runListPosition(scope, { limit: 2, cursor: encoded })?.id).toBe(id);
  for (const changed of [{ limit: 1 }, { limit: 2, state: 'queued' }, { limit: 2, outcome: 'passed' }, { limit: 2, order: 'oldest' }]) {
    expect(() => runListPosition(scope, { ...changed, cursor: encoded } as RunListQuery)).toThrow();
  }
  expect(() => runListPosition({ ...scope, workspaceId: id }, { ...query, cursor: encoded })).toThrow();
  for (const bad of ['x'.repeat(513), encoded + '=', 'a', btoa(JSON.stringify({ after: id })), btoa(JSON.stringify(['run-page-v0']))]) {
    expect(() => captureRunListCursor(bad)).toThrow();
  }
});
it('rejects noncanonical UTC spellings and tuple identity aliases', () => {
  for (const timestamp of [requestedAt.replace('.000Z', 'Z'), requestedAt.replace('Z', '+00:00'), '2026-02-30T00:00:00.000Z']) {
    expect(() => encodeRunListCursor({ scope, query, requestedAt: timestamp, id })).toThrow();
  }
  const tuple = JSON.parse(atob(cursor())) as unknown[];
  tuple[1] = 'A0000000-0000-4000-8000-000000000001';
  expect(() => captureRunListCursor(btoa(JSON.stringify(tuple)).replace(/=+$/, ''))).toThrow();
});
it('checks strict tie ordering, filters, last cursor, short pages and continuation position', async () => {
  const run = await fixture('valid/run.json') as Run;
  const older = { ...run, id: '00000000-0000-4000-8000-000000000004' };
  const page = { scope, items: [run, older], nextCursor: encodeRunListCursor({ scope, query, requestedAt, id: older.id }) };
  expect(runListPageMatches(page, scope, query)).toBe(true);
  for (const invalid of [{ ...page, items: [older, run] }, { ...page, items: [run, run] }, { ...page, items: [older] },
    { ...page, nextCursor: cursor() }, { ...page, items: [{ ...run, state: 'active' as const }, older] }]) {
    expect(runListPageMatches(invalid, scope, { ...query, state: 'queued' })).toBe(false);
  }
  expect(runListPageMatches({ ...page, items: [older], nextCursor: null }, scope, { ...query, cursor: cursor() })).toBe(true);
  expect(runListPageMatches({ ...page, nextCursor: null }, scope, { ...query, cursor: cursor() })).toBe(false);
  expect(runListPageMatches({ scope, items: [older, run], nextCursor: null }, scope, { ...query, order: 'oldest' })).toBe(true);
});
