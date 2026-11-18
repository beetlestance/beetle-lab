import { installedEngineVersion } from './engine-version.js';
import { useQuery } from '@tanstack/react-query';
import type { Run, SuiteRevision } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';

/**
 * Reads the live view adds next to RunDetail's polled run: the saved revision
 * (stages, thresholds, request names), the suite (name, latest revision), the
 * queue while waiting and the p95-rise attribution once sealed. Session access
 * (read-only, restored backup) comes from SessionContext, not a read. All go through the generated client; none retry automatically.
 */
const workspace = (run: Run) => ({ organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId });

export function useRevision(run: Run) {
  const api = useApi();
  const params = { ...workspace(run), revisionId: run.revisionId };
  return useQuery({
    queryKey: queryKeys.suiteRevision(params.organizationId, params.workspaceId, run.revisionId),
    queryFn: ({ signal }) => readResult(api.getSuiteRevision({ params, signal })),
    select: (value) => verifiedRunRevision(value, run),
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

export type QueueRead = ReturnType<typeof useQueue>;

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

/** Resolve direct-entry names without making metadata availability a metrics gate. */
export function useLiveNamespace(run: Run) {
  const api = useApi();
  const params = workspace(run);
  const organization = useQuery({
    queryKey: queryKeys.organization(params.organizationId),
    queryFn: ({ signal }) =>
      readResult(api.getOrganization({ params: { organizationId: params.organizationId }, signal })),
  });
  const current = useQuery({
    queryKey: queryKeys.workspace(params.organizationId, params.workspaceId),
    enabled: organization.isSuccess,
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params, signal })),
  });
  return {
    organization,
    workspace: current,
    busy: organization.isFetching || current.isFetching,
    retry: () => {
      if (organization.isError) void organization.refetch({ cancelRefetch: false });
      else void current.refetch({ cancelRefetch: false });
    },
  };
}

/** Select guards fresh API replies and already-cached immutable revisions alike. */
function verifiedRunRevision(value: SuiteRevision, run: Run): SuiteRevision {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    !same(value.id, run.revisionId) ||
    !same(value.suiteId, run.suiteId) ||
    value.digest !== run.revisionDigest ||
    !same(value.scope.organizationId, run.scope.organizationId) ||
    !same(value.scope.workspaceId, run.scope.workspaceId)
  )
    throw new Error('Saved revision does not match this run.');
  return value;
}

export interface EngineVersionRead {
  readonly value: string | null;
  readonly pending: boolean;
  readonly busy: boolean;
  retry(): void;
}
/** One immutable-label read per selected run; no additional polling or session owner. */
export function usePhaseReads(run: Run, starting: boolean, waiting: boolean) {
  const api = useApi();
  const queue = useQueue(run, waiting);
  const engine = run.engine;
  const version = useQuery({
    queryKey: [
      ...queryKeys.run(run.scope.organizationId, run.scope.workspaceId, run.id),
      'engine-version',
      run.activeAttemptId,
      engine.profileId,
      engine.id,
      engine.imageDigest,
      engine.configVersion,
    ],
    queryFn: ({ signal }) => readResult(api.getInstallationStatus({ signal })),
    select: (status) => installedEngineVersion(status, run),
    enabled: starting,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const engineVersion: EngineVersionRead = {
    value: version.isError ? null : (version.data ?? null),
    pending: version.isPending,
    busy: version.isFetching,
    retry: () => {
      void version.refetch({ cancelRefetch: false });
    },
  };
  return { queue, engineVersion };
}
export type PhaseReads = ReturnType<typeof usePhaseReads>;
