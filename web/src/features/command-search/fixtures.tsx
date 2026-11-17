import { encodeSuiteListCursor, normalizeSuiteListQuery } from '@beetle/contracts/api';
import type { Suite, SuitePage } from '@beetle/contracts/api';
import { ids, json, readNamespace } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { historyPage, run } from '../runs/test-fixtures.js';
export { ids, json, readNamespace, testClient, mount, deferred, apiError, workspace } from '../../app/test-fixtures.js';
export const suiteId = '11111111-1111-4111-8111-111111111111';
export function suite(organizationId = ids.a): Suite {
  return {
    id: suiteId,
    scope: { kind: 'workspace', organizationId, workspaceId: ids.workspace },
    name: 'Shared suite',
    version: 1,
    folderId: ids.root,
    currentRevisionId: null,
  };
}
/** A full first page (100 rows, no runs, descending ids) whose cursor the client accepts as a continuation. */
export function fullSuitePage(organizationId = ids.a): SuitePage {
  const scope = { kind: 'workspace' as const, organizationId, workspaceId: ids.workspace };
  const items = Array.from({ length: 100 }, (_, index) => ({
    ...suite(organizationId),
    id: `22222222-2222-4222-8222-${String(999 - index).padStart(12, '0')}`,
    name: index === 0 ? 'Shared suite' : `Suite ${index}`,
  }));
  const summaries = items.map((item) => ({
    suiteId: item.id,
    engineId: null,
    group: 'no_runs' as const,
    latestRun: null,
  }));
  const nextCursor = encodeSuiteListCursor({
    scope,
    query: normalizeSuiteListQuery({ limit: 100 }),
    requestedAt: null,
    id: items.at(-1)!.id,
  });
  return { scope, items, summaries, nextCursor };
}
export function read(request: RequestRecord): Response {
  const organizationId = request.path.includes(ids.b) ? ids.b : ids.a;
  const scope = { kind: 'workspace' as const, organizationId, workspaceId: ids.workspace };
  if (request.path.includes('/suites?')) return json({ scope, items: [suite(organizationId)], nextCursor: null });
  if (request.path.includes('/runs?')) return json(historyPage([run(organizationId)], scope));
  if (request.path.endsWith('/suites/' + suiteId)) return json(suite(organizationId));
  if (request.path.includes('/revisions?')) return json({ scope, suiteId, items: [], nextCursor: null });
  return readNamespace(request);
}
