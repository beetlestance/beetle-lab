import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SettingsScope } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { NavTabs } from '../../components/Tabs.js';
import type { NavTabItem } from '../../components/Tabs.js';

/** Subscribes to one cached value without issuing a request or creating a cache entry. */
function useCached<T>(read: (data: (key: readonly unknown[]) => unknown) => T): T {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  const snapshot = () => read((key) => client.getQueryData(key));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function nameOf(data: unknown): string | undefined {
  const name = typeof data === 'object' && data !== null ? (data as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : undefined;
}

/**
 * The level being edited, by name when a page has already read it ("acme"); otherwise a
 * plain description. Never reads the namespace just to label the page.
 */
export function useScopeName(scope: SettingsScope): string {
  return useCached((get) => {
    if (scope.kind === 'installation') return 'installation';
    if (scope.kind === 'organization')
      return nameOf(get(queryKeys.organization(scope.organizationId))) ?? 'this organization';
    return nameOf(get(queryKeys.workspace(scope.organizationId, scope.workspaceId))) ?? 'this workspace';
  });
}

function draftCount(get: (key: readonly unknown[]) => unknown, key: readonly string[]): number | undefined {
  const draft = get(['settings-draft', ...key]);
  const count = draft && typeof draft === 'object' ? Object.keys(draft).length : 0;
  return count > 0 ? count : undefined;
}

/** Installation / Organization / Workspace, with the number of unsaved changes kept at each level. */
export function ScopeTabs({ scope }: { scope: SettingsScope }) {
  const organizationId = scope.kind === 'installation' ? undefined : scope.organizationId;
  const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined;
  const counts = useCached((get) =>
    JSON.stringify([
      draftCount(get, queryKeys.installationSettings),
      organizationId ? draftCount(get, queryKeys.organizationSettings(organizationId)) : undefined,
      organizationId && workspaceId
        ? draftCount(get, queryKeys.workspaceSettings(organizationId, workspaceId))
        : undefined,
    ]),
  );
  const [installation, organization, workspace] = JSON.parse(counts) as (number | null)[];
  const items: NavTabItem[] = [
    {
      to: routes.settings,
      label: 'Installation',
      current: scope.kind === 'installation',
      count: installation ?? undefined,
    },
  ];
  if (organizationId)
    items.push({
      to: routes.organizationSettings(organizationId),
      label: 'Organization',
      current: scope.kind === 'organization',
      count: organization ?? undefined,
    });
  if (organizationId && workspaceId)
    items.push({
      to: routes.workspaceSettings(organizationId, workspaceId),
      label: 'Workspace',
      current: true,
      count: workspace ?? undefined,
    });
  return <NavTabs label="Settings level" items={items} size="md" />;
}
