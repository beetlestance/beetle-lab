import type { ExportJob, LatestRevisionExport, WorkspaceScope } from './generated/types.js';

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const scopeMatches = (left: WorkspaceScope, right: WorkspaceScope) =>
  same(left.organizationId, right.organizationId) && same(left.workspaceId, right.workspaceId);

/** Schema validation precedes this exact route/revision and nested-job ownership check. */
export function latestRevisionExportMatches(
  value: LatestRevisionExport,
  scope: WorkspaceScope,
  revisionId: string,
): boolean {
  return (
    scopeMatches(value.scope, scope) &&
    same(value.revisionId, revisionId) &&
    (value.job === null ||
      (scopeMatches(value.job.scope, scope) &&
        same(value.job.revisionId, revisionId) &&
        exportJobStateMatches(value.job)))
  );
}

export function exportJobStateMatches(job: ExportJob): boolean {
  if (job.state === 'ready') return job.artifact !== null && job.reason === null;
  if (job.state === 'cancelled') return job.cancellationRequested && job.reason === 'cancelled';
  if (job.state === 'failed' || job.state === 'unknown') return job.reason !== null;
  return job.artifact === null;
}
