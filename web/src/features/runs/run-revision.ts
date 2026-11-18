import type { Run, SuiteRevision } from '@beetle/contracts/api';

/** Select guards fresh API replies and already-cached immutable revisions alike. */
export function verifiedRunRevision(value: SuiteRevision, run: Run): SuiteRevision {
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
