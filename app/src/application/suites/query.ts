import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { ApiTypes } from '@beetle/contracts/api';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { SuiteKey, SuiteList, RevisionList, SuiteReader } from '../../ports/suites.js';

export function suiteSnapshot<T>(value: T, maximum = 2097152): T {
  return immutableSnapshot(JSON.parse(encodeJson(value, maximum)) as T);
}
export function checkedSuiteValue<N extends 'Suite' | 'SuiteRevision' | 'SuitePage' | 'SuiteRevisionPage'>(
  name: N, input: unknown,
): ApiTypes[N] {
  const result = validateApi(name, suiteSnapshot(input));
  if (!result.ok) throw new Error('Invalid suite repository response');
  return immutableSnapshot(result.value);
}
export async function getSuite(key: SuiteKey, reader: SuiteReader) {
  const expected = suiteSnapshot(key, 2048);
  const value = checkedSuiteValue('Suite', await reader.getSuite(suiteSnapshot(expected, 2048)));
  requireRule(sameScope(value.scope, expected.scope) && sameUuid(value.id, expected.id), 'not_found');
  return value;
}
export async function getRevision(key: SuiteKey, reader: SuiteReader) {
  const expected = suiteSnapshot(key, 2048);
  const value = checkedSuiteValue('SuiteRevision', await reader.getRevision(suiteSnapshot(expected, 2048)));
  requireRule(sameScope(value.scope, expected.scope) && sameUuid(value.id, expected.id), 'not_found');
  return value;
}
function checkedPage(query: SuiteList | RevisionList, value: ApiTypes['SuitePage'] | ApiTypes['SuiteRevisionPage']) {
  requireRule(sameScope(value.scope, query.scope), 'not_found');
  if (value.items.length > query.limit) throw new Error('Invalid suite repository page');
  const ids = new Set<string>();
  for (const item of value.items) {
    requireRule(sameScope(item.scope, query.scope), 'not_found');
    if ('suiteId' in query) {
      requireRule('suiteId' in item && sameUuid(item.suiteId, query.suiteId), 'not_found');
    }
    if (ids.has(item.id.toLowerCase())) throw new Error('Invalid suite repository page');
    ids.add(item.id.toLowerCase());
  }
}
export async function listSuites(query: SuiteList, reader: SuiteReader) {
  const expected = suiteSnapshot(query, 2048);
  const value = checkedSuiteValue('SuitePage', await reader.listSuites(suiteSnapshot(expected, 2048)));
  checkedPage(expected, value); return value;
}
export async function listRevisions(query: RevisionList, reader: SuiteReader) {
  const expected = suiteSnapshot(query, 2048);
  const value = checkedSuiteValue('SuiteRevisionPage', await reader.listRevisions(suiteSnapshot(expected, 2048)));
  requireRule(sameUuid(value.suiteId, expected.suiteId), 'not_found');
  checkedPage(expected, value); return value;
}
