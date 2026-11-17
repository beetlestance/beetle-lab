import type { Suite, SuitePage } from '@beetle/contracts/api';
import { ids, json, scope, suiteId } from './test-fixtures.js';

export function suite(organizationId = ids.a, name = 'checkout-steady'): Suite {
  return {
    id: suiteId,
    scope: { ...scope, organizationId },
    version: 1,
    name,
    folderId: ids.folder,
    currentRevisionId: null,
  };
}
export function suitesPage(organizationId = ids.a): SuitePage {
  return {
    scope: { ...scope, organizationId },
    items: [suite(organizationId)],
    nextCursor: null,
    summaries: [{ suiteId, engineId: null, group: 'no_runs', latestRun: null }],
  };
}
/** The single bounded suite-name read made by run history. */
export function suiteNames(path: string) {
  if (!path.includes('/suites?')) return undefined;
  return json(suitesPage(path.includes(ids.b) ? ids.b : ids.a));
}
