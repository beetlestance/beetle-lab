import type { Organization } from '@beetle/contracts/api';
import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
import { useWorkspaceSnapshot } from '../../app/overview.js';
import { queryKeys } from '../../app/queries.js';
import { QueryState } from '../../components/QueryState.js';

export function ActiveWorkspaces({ organization }: { organization: Organization }) {
  const api = useApi();
  const organizationId = organization.id;
  const limit = 10;
  const query = useQuery({
    queryKey: [...queryKeys.workspaces(organizationId), 'retirement-blockers', limit],
    queryFn: ({ signal }) => readResult(api.listWorkspaces({ params: { organizationId }, query: { limit }, signal })),
  });
  return (
    <div tabIndex={-1} ref={focusActiveWorkspaces}>
      <QueryState query={query}>
        {({ items, nextCursor }) =>
          items.length > 0 ? (
            <>
              <ul className="retirement-blockers" aria-label="Active workspaces">
                {items.map((workspace) => (
                  <li key={workspace.id}>
                    <span>{workspace.name}</span>
                    <WorkspaceCounts organizationId={organizationId} workspaceId={workspace.id} />
                  </li>
                ))}
              </ul>
              {nextCursor && <p>More active workspaces are listed in Workspaces.</p>}
            </>
          ) : (
            <p>No active workspaces were returned by the latest check. Close this message and try retiring again.</p>
          )
        }
      </QueryState>
    </div>
  );
}

function WorkspaceCounts({ organizationId, workspaceId }: { organizationId: string; workspaceId: string }) {
  const query = useWorkspaceSnapshot(organizationId, workspaceId);
  const counts = query.isSuccess ? query.data.counts : undefined;
  return (
    <span className="retirement-blocker-counts">
      {counts
        ? `${counts.suites.toLocaleString()} ${counts.suites === 1 ? 'suite' : 'suites'}, ${counts.runs.toLocaleString()} ${counts.runs === 1 ? 'run' : 'runs'}`
        : query.isError
          ? 'Counts unavailable'
          : 'Reading counts…'}
    </span>
  );
}

function focusActiveWorkspaces(list: HTMLDivElement | null) {
  list?.focus();
}
