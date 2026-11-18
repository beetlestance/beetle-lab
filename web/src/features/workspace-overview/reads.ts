import { terminal } from '../runs/terminal.js';
import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';

export { useWorkspaceSnapshot as useWorkspaceOverview } from '../../app/overview.js';

/**
 * First pages of suites and runs, under the exact keys and queries the list views
 * and command search use, so one read serves all three. Used only to label rows
 * (suite names, p95, start time); a failure leaves those labels unknown.
 */
export function useSuitesFirstPage(organizationId: string, workspaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.suitesPage(organizationId, workspaceId),
    queryFn: ({ signal }) =>
      readResult(api.listSuites({ params: { organizationId, workspaceId }, query: { limit: 100 }, signal })),
  });
}

export function useRunsFirstPage(organizationId: string, workspaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.runsPage(organizationId, workspaceId),
    queryFn: ({ signal }) =>
      readResult(api.listRuns({ params: { organizationId, workspaceId }, query: { limit: 100 }, signal })),
  });
}

/** Published input count, known only when the first page is the whole inventory. */
export function usePublishedInputs(organizationId: string, workspaceId: string): number | null {
  const api = useApi();
  const query = useQuery({
    queryKey: [...queryKeys.inputs(organizationId, workspaceId), 'overview-count'],
    queryFn: ({ signal }) =>
      readResult(api.listInputs({ params: { organizationId, workspaceId }, query: { limit: 100 }, signal })),
  });
  const page = query.isError ? undefined : query.data;
  if (!page || page.nextCursor !== null) return null;
  return page.items.filter((item) => item.state === 'published').length;
}

export function useInstallationStatus() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.installationStatus,
    queryFn: ({ signal }) => readResult(api.getInstallationStatus({ signal })),
  });
}

/** Only the featured run polls; the overview's aggregate snapshot stays manual. */
export function useOverviewRun(organizationId: string, workspaceId: string, runId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.run(organizationId, workspaceId, runId),
    queryFn: ({ signal }) => readResult(api.getRun({ params: { organizationId, workspaceId, runId }, signal })),
    refetchInterval: (query) => (terminal(query.state.data) || query.state.status === 'error' ? false : 2000),
    refetchIntervalInBackground: false,
  });
}

/** One featured-suite read avoids deriving its name from a potentially partial list. */
export function useFeaturedSuite(organizationId: string, workspaceId: string, suiteId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.suite(organizationId, workspaceId, suiteId),
    queryFn: ({ signal }) => readResult(api.getSuite({ params: { organizationId, workspaceId, suiteId }, signal })),
  });
}
