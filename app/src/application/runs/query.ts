import { normalizeRunListQuery, runListPosition, runListPageMatches, validateApi } from '@beetle/contracts/api';
import type { Run, RunPage } from '@beetle/contracts/api';
import { requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { RunKey, RunList, RunReader } from '../../ports/runs.js';
import { checkedRun, checkedRunPage, runSnapshot } from './response.js';

function expectedKey(key: RunKey): RunKey {
  const copy = runSnapshot(key, 2048);
  requireRule(Object.keys(copy).every(field => ['scope', 'id'].includes(field)));
  requireRule(validateApi('WorkspaceScope', copy.scope).ok && validateApi('Uuid', copy.id).ok);
  return copy;
}

function expectedQuery(query: RunList): RunList {
  const copy = runSnapshot(query, 2048);
  const { scope, ...page } = copy;
  requireRule(validateApi('WorkspaceScope', scope).ok && validateApi('RunListQuery', page).ok);
  const normalized = normalizeRunListQuery(page);
  try { runListPosition(scope, normalized); } catch { requireRule(false); }
  return { scope, ...normalized };
}

export async function getRun<Reader extends Pick<RunReader, 'getRun'>>(key: RunKey, reader: Reader): Promise<Run> {
  const expected = expectedKey(key);
  const value = checkedRun(await reader.getRun(runSnapshot(expected, 2048)));
  requireRule(sameScope(value.scope, expected.scope) && sameUuid(value.id, expected.id), 'not_found');
  return value;
}

export async function listRuns(query: RunList, reader: RunReader): Promise<RunPage> {
  const expected = expectedQuery(query);
  const value = checkedRunPage(await reader.listRuns(runSnapshot(expected, 2048)));
  requireRule(sameScope(value.scope, expected.scope), 'not_found');
  const { scope, ...page } = expected;
  if (!runListPageMatches(value, scope, page)) throw new Error('Invalid run repository page');
  return value;
}
