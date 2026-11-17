import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { queryKeys } from '../queries.js';
import { routes } from '../routes.js';
import type { ShellScope } from '../navigation.js';

/**
 * Reads an organisation name that a feature has already loaded. It never issues a
 * request and never creates a cache entry, so scope retirement stays with the feature.
 */
function useCachedOrganizationName(organizationId: string | undefined) {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  const read = () => {
    if (!organizationId) return undefined;
    const data: unknown = client.getQueryData(queryKeys.organization(organizationId));
    const name = typeof data === 'object' && data !== null ? (data as { name?: unknown }).name : undefined;
    return typeof name === 'string' ? name : undefined;
  };
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Install/organisation switcher ("acme ▾"). Links to the organisation list, which is
 * where switching happens. Shows the cached organisation name when known.
 */
export function ScopeSwitcher({ scope }: { scope: ShellScope }) {
  const name = useCachedOrganizationName(scope.organizationId);
  const label = scope.organizationId ? (name ?? 'Organization') : 'Local install';
  return (
    <Link className="shell-scope" to={routes.organizations} aria-label={`${label}, switch organization`}>
      <span className="shell-scope-name">{label}</span>
      <span className="shell-scope-caret" aria-hidden="true">
        ▾
      </span>
    </Link>
  );
}
