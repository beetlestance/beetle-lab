import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from './api.js';
import { queryKeys } from './queries.js';

/** One manually refreshed snapshot owner per mounted workspace surface. */
export function useWorkspaceSnapshot(organizationId: string, workspaceId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.workspace(organizationId, workspaceId), 'overview'],
    enabled,
    queryFn: ({ signal }) => readResult(api.getWorkspaceOverview({ params: { organizationId, workspaceId }, signal })),
  });
}
