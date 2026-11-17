import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import type { RunScope } from './types.js';

/**
 * One bounded page (100) of workspace suites, most recently run first, for names in
 * run rows and the suite filter. Suites beyond it show their short ID; a failed
 * read leaves names unknown without blocking history. Stored under the runs scope
 * so leaving the workspace removes it.
 */
export function useSuiteNames(scope: RunScope) {
  const api = useApi();
  const query = useQuery({
    queryKey: [...queryKeys.runs(scope.organizationId, scope.workspaceId), 'suite-names'],
    queryFn: ({ signal }) =>
      readResult(
        api.listSuites({
          params: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
          query: { limit: 100 },
          signal,
        }),
      ),
  });
  const suites = query.data?.items.map((suite) => ({ id: suite.id.toLowerCase(), name: suite.name }));
  const names = new Map(suites?.map((suite) => [suite.id, suite.name]));
  return { suites: query.isError ? [] : suites, name: (suiteId: string) => names.get(suiteId.toLowerCase()) };
}
