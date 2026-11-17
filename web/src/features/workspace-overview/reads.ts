import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';

/** Installation status has no shared key yet (wave 0); scoped to the installation, never to a workspace. */
export const installationStatusKey = ['installation', 'status'] as const;

export function useWorkspaceOverview(organizationId: string, workspaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.workspace(organizationId, workspaceId), 'overview'],
    queryFn: ({ signal }) => readResult(api.getWorkspaceOverview({ params: { organizationId, workspaceId }, signal })),
  });
}

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
    queryKey: installationStatusKey,
    queryFn: ({ signal }) => readResult(api.getInstallationStatus({ signal })),
  });
}
