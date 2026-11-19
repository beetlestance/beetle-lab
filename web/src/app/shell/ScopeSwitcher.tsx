import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readResult, useApi } from '../api.js';
import { QueryState } from '../../components/QueryState.js';
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

export function ScopeSwitcher({ scope, path }: { scope: ShellScope; path: string }) {
  const name = useCachedOrganizationName(scope.organizationId);
  const label = scope.organizationId ? (name ?? 'Organization') : 'Organizations';
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.contains(document.activeElement)) return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={root} className="shell-switcher">
      <button
        ref={trigger}
        type="button"
        className="shell-scope"
        aria-label={`${label}, switch organization`}
        aria-expanded={open}
        aria-controls={open ? 'shell-organizations' : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className="shell-scope-name">{label}</span>
        <span className="shell-scope-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && <OrganizationLinks path={path} selected={scope.organizationId} close={() => setOpen(false)} />}
    </div>
  );
}

function OrganizationLinks({
  path,
  selected,
  close,
}: {
  path: string;
  selected: string | undefined;
  close: () => void;
}) {
  const inWorkspaces = path === routes.workspaces || path === routes.organizationWorkspaces(selected ?? '');
  const api = useApi();
  const query = useQuery({
    queryKey: [...queryKeys.organizations, 'switcher'],
    queryFn: ({ signal }) => readResult(api.listOrganizations({ query: { limit: 20 }, signal })),
  });
  return (
    <nav id="shell-organizations" aria-label="Switch organization" className="shell-scope-links">
      <QueryState query={query}>
        {({ items }) => (
          <ul role="list">
            {items.map((org) => {
              const to = inWorkspaces ? routes.organizationWorkspaces(org.id) : routes.organization(org.id);
              return (
                <li key={org.id}>
                  <Link
                    to={to}
                    aria-current={org.id === selected ? 'true' : undefined}
                    onClick={to === path ? close : undefined}
                  >
                    {org.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <Link to={routes.organizations} onClick={path === routes.organizations ? close : undefined}>
        All organizations
      </Link>
    </nav>
  );
}
