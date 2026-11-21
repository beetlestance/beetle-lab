import type { Organization } from '@beetle/contracts/api';
import { useQuery } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
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
                  <li key={workspace.id}>{workspace.name}</li>
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

function focusActiveWorkspaces(list: HTMLDivElement | null) {
  list?.focus();
}
