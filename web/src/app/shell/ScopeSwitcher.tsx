import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readResult, useApi } from '../api.js';
import { Button } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { useOrganizationEditor } from '../../features/organizations/index.js';
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
  // Lives here, not in the dropdown: the dialog outlives the dropdown it was opened from.
  const editor = useOrganizationEditor();

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
      {open && (
        <OrganizationLinks
          path={path}
          selected={scope.organizationId}
          close={() => setOpen(false)}
          create={() => {
            setOpen(false);
            editor.create();
          }}
        />
      )}
    </div>
  );
}

/** Every organization, 20 at a time, then the one action the app has for organizations. */
function OrganizationLinks({
  path,
  selected,
  close,
  create,
}: {
  path: string;
  selected: string | undefined;
  close: () => void;
  create: () => void;
}) {
  const inWorkspaces = path === routes.workspaces || path === routes.organizationWorkspaces(selected ?? '');
  const api = useApi();
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.organizations, 'switcher'],
    queryFn: ({ signal, pageParam }) =>
      readResult(api.listOrganizations({ query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) }, signal })),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <nav id="shell-organizations" aria-label="Switch organization" className="shell-scope-links">
      <QueryState query={query}>
        {({ pages }) => (
          <ul role="list">
            {pages
              .flatMap((page) => page.items)
              .map((org) => {
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
      {query.hasNextPage && (
        <Button size="sm" variant="text" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      )}
      <Button size="sm" className="shell-scope-create" onClick={create}>
        Create organization
      </Button>
    </nav>
  );
}
