import { expect, it } from 'vitest';
import { normalizeRunListQuery, normalizeRunSearchName, runSearchTerms, encodeRunListCursor,
  captureRunListCursor, runListPosition } from '../../src/api/index.js';
const scope = { kind: 'workspace' as const, organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002' };
const key = { scope, requestedAt: '2026-11-09T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000003' };
it('normalizes literal Unicode search without regex, locale or path interpretation', () => {
  expect(normalizeRunSearchName('  ＡＢＣ/İ  ')).toBe('abc/i̇');
  expect(normalizeRunSearchName('J\u030Cxx')).toBe('ǰxx');
  expect(normalizeRunSearchName(normalizeRunSearchName('J\u030Cxx'))).toBe('ǰxx');
  expect(normalizeRunSearchName('a%_')).toBe('a%_');
  expect(runSearchTerms('😀界a😀界a')).toEqual(['😀界a', '界a😀', 'a😀界']);
  for (const name of ['', 'ab', '\ud800xx', 'a\0b', 'x\ny', '界'.repeat(22)]) {
    expect(() => normalizeRunListQuery({ limit: 1, name })).toThrow();
  }
  expect(normalizeRunListQuery({ limit: 1, runIdPrefix: 'ABCDEF01-ABCD' }).runIdPrefix).toBe('abcdef01-abcd');
  for (const prefix of ['abcdef0', 'abcdefgh', 'abcdef01x', 'abcdef01-abcdx']) {
    expect(() => normalizeRunListQuery({ limit: 1, runIdPrefix: prefix })).toThrow();
  }
  expect(() => normalizeRunListQuery({ limit: 1, name: 'abc', runIdPrefix: 'abcdef01' })).toThrow();
});
it('round-trips strict UTF8 search cursors and binds both search modes', () => {
  for (const search of [{ name: '界😀abc' }, { name: 'J\u030Cxx' }, { name: '"'.repeat(64) }, { runIdPrefix: 'abcdef01-abcd' }]) {
    const query = normalizeRunListQuery({ limit: 100, state: 'dispatching', outcome: 'inconclusive', ...search });
    const cursor = encodeRunListCursor({ ...key, query });
    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(captureRunListCursor(cursor).query).toEqual(query);
    expect(runListPosition(scope, { ...query, cursor })?.id).toBe(key.id);
    expect(() => runListPosition(scope, { limit: 100, cursor })).toThrow();
    const changed = { ...query, name: 'different', cursor }; delete changed.runIdPrefix;
    expect(() => runListPosition(scope, changed)).toThrow();
  }
});
