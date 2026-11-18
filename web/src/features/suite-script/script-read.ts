import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { latestRevisionExportMatches } from '@beetle/contracts/api';
import type { ExportJob, SuiteRevision, WorkspaceScope } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { maximumShownScriptBytes, readScript } from '../exports/scriptText.js';

export type ScriptRead = {
  data: string | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch(): Promise<unknown>;
};
const wrongOwner = new Error('The script export does not match this revision.');
function invalidBinding(scope: WorkspaceScope, revision: SuiteRevision | undefined, job: ExportJob | undefined) {
  if (!revision || !job) return false;
  return (
    !latestRevisionExportMatches({ scope: revision.scope, revisionId: revision.id, job }, scope, revision.id) ||
    job.revisionDigest !== revision.digest
  );
}
function contentKey(scope: WorkspaceScope, revision: SuiteRevision | undefined, job: ExportJob | undefined) {
  return [
    ...queryKeys.export(scope.organizationId, scope.workspaceId, job?.id ?? ''),
    'content',
    revision?.id ?? '',
    revision?.digest ?? '',
    ...artifactKey(job),
  ];
}
function artifactKey(job: ExportJob | undefined) {
  const artifact = job?.artifact;
  return artifact ? ([artifact.sha256, artifact.bytes] as const) : (['', 0] as const);
}
function readable(job: ExportJob | undefined) {
  return job?.state === 'ready' && !!job.artifact && job.artifact.bytes <= maximumShownScriptBytes;
}
function visibleRead(query: UseQueryResult<string>, invalid: boolean): ScriptRead {
  return {
    data: invalid ? undefined : query.data,
    isError: invalid || query.isError,
    isPending: !invalid && query.isPending,
    isFetching: query.isFetching,
    error: invalid ? wrongOwner : query.error,
    refetch: () => query.refetch({ cancelRefetch: false }),
  };
}

/** One verified immutable artifact, keyed by published digest/size and expected revision. */
export function useScriptText(
  scope: WorkspaceScope,
  revision: SuiteRevision | undefined,
  job: ExportJob | undefined,
): ScriptRead {
  const invalid = invalidBinding(scope, revision, job);
  const query = useQuery({
    queryKey: contentKey(scope, revision, job),
    enabled: !!revision && readable(job) && !invalid,
    queryFn: ({ signal }) => readOwned({ revision, job, invalid }, signal),
    retry: false,
    staleTime: Infinity,
  });
  return visibleRead(query, invalid);
}
function readOwned(
  owner: { revision: SuiteRevision | undefined; job: ExportJob | undefined; invalid: boolean },
  signal: AbortSignal,
) {
  if (!owner.revision || !owner.job || owner.invalid) throw wrongOwner;
  return readScript(owner.job, signal);
}
