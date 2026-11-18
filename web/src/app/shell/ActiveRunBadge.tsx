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
    const state = client.getQueryState<OrganizationOverview | WorkspaceOverview>(key);
    return state?.status === 'success' ? state.data : undefined;
  };
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const count = snapshot?.counts.active;
  if (count === undefined || count === 0) return null;
  return (
    <span className="shell-nav-badge" title={`Overview snapshot: ${snapshot?.generatedAt}`}>
      <span className="sr-only">, </span>
      {count.toLocaleString()}
      <span className="sr-only"> running</span>
      <span className="shell-nav-running" aria-hidden="true">
        running
      </span>
    </span>
  );
}
