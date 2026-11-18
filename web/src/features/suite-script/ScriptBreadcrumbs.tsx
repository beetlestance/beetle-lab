import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Suite, SuiteRevision, SuiteRevisionSummary, Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes, validId } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { engineLabel } from '../suite-overview/status.js';

const invalidOrigin = (ids: readonly string[]) => ids.length > 1 || (ids.length === 1 && !validId(ids[0]));

/** Optional run provenance is verified before rendering; query text never supplies a name. */
export function ScriptBreadcrumbs({
  suite,
  revision,
  workspace,
  choices,
}: {
  suite: Suite;
  revision: SuiteRevision;
  workspace: Workspace;
  choices: readonly SuiteRevisionSummary[];
}) {
  const api = useApi();
  const [search] = useSearchParams();
  const ids = search.getAll('run');
  const invalid = invalidOrigin(ids);
  const runId = !invalid ? ids[0] : undefined;
  const { organizationId, workspaceId } = suite.scope;
  const query = useQuery({
    queryKey: queryKeys.run(organizationId, workspaceId, runId ?? ''),
    enabled: runId !== undefined,
    queryFn: ({ signal }) => readResult(api.getRun({ params: { organizationId, workspaceId, runId: runId! }, signal })),
  });
  const currentId = suite.currentRevisionId?.toLowerCase();
  const current =
    revision.id.toLowerCase() === currentId ? revision : choices.find((item) => item.id.toLowerCase() === currentId);
  const latest = current ? `, latest is ${current.ordinal}` : '';
  const suffix = `${suite.name} (${engineLabel(revision.engineId)}), script revision ${revision.ordinal}${latest}`;
  const plain = routes.suiteScript(organizationId, workspaceId, suite.id, revision.id);
  if (invalid || (query.data && query.data.suiteId.toLowerCase() !== suite.id.toLowerCase()))
    return (
      <nav className="script-crumbs" aria-label="Breadcrumb">
        <span>Run context is invalid. </span>
        <Link to={plain}>Use suite context</Link>
      </nav>
    );
  return (
    <nav className="script-crumbs" aria-label="Breadcrumb">
      {runId ? (
        <QueryState query={query}>
          {(run) => (
            <Link to={routes.run(organizationId, workspaceId, run.id)}>
              ← {workspace.name} / Run {run.id.slice(0, 8)}, {suffix}
            </Link>
          )}
        </QueryState>
      ) : (
        <Link to={routes.suite(organizationId, workspaceId, suite.id)}>
          ← {workspace.name} / {suffix}
        </Link>
      )}
    </nav>
  );
}
