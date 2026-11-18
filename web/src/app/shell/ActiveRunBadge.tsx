import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OrganizationOverview, WorkspaceOverview } from '@beetle/contracts/api';
import type { ShellScope } from '../navigation.js';
import { queryKeys } from '../queries.js';
import { useSessionAccess } from '../session.js';

/** Follow the scope's validated Overview snapshot without a second read or cache owner. */
export function ActiveRunBadge({ organizationId, workspaceId }: ShellScope) {
  const client = useQueryClient();
  const { readOnly } = useSessionAccess();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  const read = () => {
    if (!organizationId || readOnly) return undefined;
    const key = workspaceId
      ? [...queryKeys.workspace(organizationId, workspaceId), 'overview']
      : [...queryKeys.organization(organizationId), 'overview'];
    return client.getQueryState<OrganizationOverview | WorkspaceOverview>(key);
  };
  const state = useSyncExternalStore(subscribe, read, read);
  const count = state?.status === 'success' ? state.data?.counts.active : undefined;
  if (count === undefined || count === 0) return null;
  return (
    <span className="shell-nav-badge" title={`Overview snapshot: ${state?.data?.generatedAt}`}>
      <span className="sr-only">, </span>
      {count.toLocaleString()}
      <span className="sr-only"> running</span>
      <span className="shell-nav-running" aria-hidden="true">
        running
      </span>
    </span>
  );
}
