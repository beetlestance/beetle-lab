import { useQuery } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';

/**
 * Reads the live view adds next to RunDetail's polled run: the saved revision
 * (stages, thresholds, request names), the suite (name, latest revision), the
 * queue while waiting, the p95-rise attribution once sealed, and the restored
 * backup date. All go through the generated client; none retry automatically.
 */
const workspace = (run: Run) => ({ organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId });

export function useRevision(run: Run) {
  const api = useApi();
  const params = { ...workspace(run), revisionId: run.revisionId };
  return useQuery({
    queryKey: queryKeys.suiteRevision(params.organizationId, params.workspaceId, run.revisionId),
    queryFn: ({ signal }) => readResult(api.getSuiteRevision({ params, signal })),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSuite(run: Run) {
  const api = useApi();
  const params = { ...workspace(run), suiteId: run.suiteId };
  return useQuery({
    queryKey: queryKeys.suite(params.organizationId, params.workspaceId, run.suiteId),
    queryFn: ({ signal }) => readResult(api.getSuite({ params, signal })),
  });
}

export function useRevisions(run: Run, enabled: boolean) {
  const api = useApi();
  const params = { ...workspace(run), suiteId: run.suiteId };
  const query = { limit: 20 };
  return useQuery({
    queryKey: [...queryKeys.suiteRevisions(params.organizationId, params.workspaceId, run.suiteId), 'picker', 20],
    queryFn: ({ signal }) => readResult(api.listSuiteRevisions({ params, query, signal })),
    enabled,
  });
}

/** Slot holders and queue position, polled every two seconds while the run waits. */
export function useQueue(run: Run, enabled: boolean) {
  const api = useApi();
  const params = { ...workspace(run), runId: run.id };
  return useQuery({
    queryKey: queryKeys.runQueue(params.organizationId, params.workspaceId, run.id),
    queryFn: ({ signal }) => readResult(api.getRunQueue({ params, signal })),
    enabled,
    refetchInterval: (query) => (enabled && query.state.status !== 'error' ? 2000 : false),
    refetchIntervalInBackground: false,
  });
}

/** One read once the attempt is sealed; it streams the whole metric history server-side. */
export function useAttribution(run: Run, enabled: boolean) {
  const api = useApi();
  const params = { ...workspace(run), runId: run.id, attemptId: run.activeAttemptId };
  return useQuery({
    queryKey: queryKeys.runLatencyAttribution(params.organizationId, params.workspaceId, run.id, run.activeAttemptId),
    queryFn: ({ signal }) => readResult(api.getRunLatencyAttribution({ params, signal })),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * The read-only and restored-backup markers of the current browser session. Only
 * those are kept in the cache; the session's CSRF token is dropped here.
 */
export function useRestoredBackup() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.browserSession,
    queryFn: async ({ signal }) => {
      const session = await readResult(api.getBrowserSession({ signal }));
      return { readOnly: session.readOnly === true, createdAt: session.restoredBackup?.createdAt ?? null };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
