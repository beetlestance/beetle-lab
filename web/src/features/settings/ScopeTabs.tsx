import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SettingsScope } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useRememberedSettingsScope } from '../../app/settings-scope.js';
import { Link } from 'react-router-dom';
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

/** Installation / Organization, with the number of unsaved changes kept at each level. */
export function ScopeTabs({ scope, choose }: { scope: SettingsScope; choose?: 'organization' }) {
  const remembered = useRememberedSettingsScope();
  const organizationId = scope.kind === 'installation' ? remembered.organizationId : scope.organizationId;
  const [installation, organization] = useScopeDraftCounts(organizationId);
  const items: NavTabItem[] = [
    {
      to: routes.settings,
      label: 'Installation',
      current: scope.kind === 'installation' && !choose,
      count: installation ?? undefined,
    },
    {
      to: organizationId ? routes.organizationSettings(organizationId) : routes.chooseSettings(),
      label: 'Organization',
      current: scope.kind === 'organization' || choose === 'organization',
      count: organization ?? undefined,
    },
  ];
  return <NavTabs label="Settings level" items={items} size="md" />;
}

/** Inside a workspace, the levels it inherits from are plain links, not tabs. */
export function ParentLevels({ scope }: { scope: Extract<SettingsScope, { kind: 'workspace' }> }) {
  return (
    <p className="settings-parents">
      Values not set here come from{' '}
      <Link to={routes.organizationSettings(scope.organizationId)}>organization settings</Link>, then{' '}
      <Link to={routes.settings}>installation settings</Link>.
    </p>
  );
}

function useScopeDraftCounts(organizationId: string | undefined) {
  const counts = useCached((get) =>
    JSON.stringify([
      draftCount(get, queryKeys.installationSettings),
      organizationId ? draftCount(get, queryKeys.organizationSettings(organizationId)) : undefined,
    ]),
  );
  return JSON.parse(counts) as (number | null)[];
}
