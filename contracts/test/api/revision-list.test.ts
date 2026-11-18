import { expect, it } from 'vitest';
import base from '../../fixtures/api/valid/suite-revision-page.json' with { type: 'json' };
import { createApiClient, validateApi, encodeRevisionListCursor, revisionListPageMatches, revisionListPosition } from '../../src/api/index.js';
import type { SuiteRevisionPage } from '../../src/api/index.js';
const captured = validateApi('SuiteRevisionPage', base);
if (!captured.ok) throw Error('Invalid revision page fixture');
const template = captured.value;
const scope = template.scope;
const suiteId = template.suiteId;
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const position = { scope, suiteId, limit: 2, ordinal: 5, id: id(5) };
const cursor = () => encodeRevisionListCursor(position);
const row = (ordinal: number, previous: number | null) => ({ ...template.items[0]!, id: id(ordinal), ordinal, previousRevisionId: previous === null ? null : id(previous) });
it('binds canonical ordinal-descending positions to scope, suite and limit', () => {
 expect(revisionListPosition(scope, suiteId, { limit: 2, cursor: cursor() })).toEqual(position);
 for (const value of ['invalid', id(5), cursor() + '=', btoa(JSON.stringify(['wrong-version']))])
  expect(() => revisionListPosition(scope, suiteId, { limit: 2, cursor: value })).toThrow();
 expect(() => revisionListPosition({ ...scope, organizationId: id(8) }, suiteId, { limit: 2, cursor: cursor() })).toThrow();
 expect(() => revisionListPosition(scope, id(8), { limit: 2, cursor: cursor() })).toThrow();
 expect(() => revisionListPosition(scope, suiteId, { limit: 3, cursor: cursor() })).toThrow();
 expect(revisionListPosition(scope, suiteId, { limit: 2 })).toBeNull();
 const maximum = { ...position, ordinal: Number.MAX_SAFE_INTEGER };
 expect(revisionListPosition(scope, suiteId, { limit: 2, cursor: encodeRevisionListCursor(maximum) })).toEqual(maximum);
 expect(() => encodeRevisionListCursor({ ...position, ordinal: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
});
it('checks descending ordinals, exact predecessors and continuations without assuming contiguous ordinals', () => {
 const page: SuiteRevisionPage = { scope, suiteId, items: [row(9, 5), row(5, 2)], nextCursor: cursor() };
 expect(revisionListPageMatches(page, scope, suiteId, { limit: 2 })).toBe(true);
 expect(revisionListPageMatches({ ...page, items: [...page.items].reverse() }, scope, suiteId, { limit: 2 })).toBe(false);
 expect(revisionListPageMatches({ ...page, items: [row(9, 2), row(5, 2)] }, scope, suiteId, { limit: 2 })).toBe(false);
 expect(revisionListPageMatches({ ...page, nextCursor: null }, scope, suiteId, { limit: 2 })).toBe(false);
 expect(revisionListPageMatches({ ...page, nextCursor: id(5) }, scope, suiteId, { limit: 2 })).toBe(false);
 expect(revisionListPageMatches({ ...page, items: [row(9, 5), row(5, null)] }, scope, suiteId, { limit: 2 })).toBe(false);
 expect(revisionListPageMatches({ scope, suiteId, items: [row(2, 1), row(1, null)], nextCursor: null }, scope, suiteId, { limit: 2, cursor: cursor() })).toBe(true);
 expect(revisionListPageMatches({ scope, suiteId, items: [], nextCursor: null }, scope, suiteId, { limit: 2 })).toBe(true);
});
it('rejects misbound revision cursors before client transport', async () => {
 let calls = 0;
 const client = createApiClient({ baseUrl: 'http://localhost', fetch: async () => { calls++; throw Error('Unexpected transport'); } });
 const result = await client.listSuiteRevisions({ params: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, suiteId: id(8) }, query: { limit: 2, cursor: cursor() } });
 expect(result).toEqual({ ok: false, error: { kind: 'request' } });
 expect(calls).toBe(0);
});
