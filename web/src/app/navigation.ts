import { routes, validId } from './routes.js';

export type ShellScope = { organizationId?: string; workspaceId?: string };
export type NavKey = 'overview' | 'workspaces' | 'engines' | 'settings' | 'docs';
export type NavItem = { key: NavKey; label: string; to: string; current: boolean };

const scopePattern = /^\/organizations\/([^/]+)(?:\/workspaces\/([^/]+))?/;

function decoded(segment: string | undefined) {
  if (segment === undefined) return undefined;
  try {
    const value = decodeURIComponent(segment);
    return validId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The organisation and workspace named by the current path, when valid. */
export function shellScope(pathname: string): ShellScope {
  const match = scopePattern.exec(pathname);
  const organizationId = decoded(match?.[1]);
  if (!organizationId) return {};
  const workspaceId = decoded(match?.[2]);
  return workspaceId ? { organizationId, workspaceId } : { organizationId };
}

function trimmed(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function overviewTarget({ organizationId, workspaceId }: ShellScope) {
  if (organizationId && workspaceId) return routes.workspace(organizationId, workspaceId);
  if (organizationId) return routes.organization(organizationId);
  return routes.organizations;
}

function settingsTarget({ organizationId, workspaceId }: ShellScope) {
  if (organizationId && workspaceId) return routes.workspaceSettings(organizationId, workspaceId);
  if (organizationId) return routes.organizationSettings(organizationId);
  return routes.settings;
}

/**
 * Header navigation, scoped to the current organisation and workspace. Overview is
 * the current scope's overview; Workspaces is current on any workspace sub-page
 * (suites, runs, inputs, compare); Settings follows the scope.
 */
export function navItems(pathname: string): NavItem[] {
  const path = trimmed(pathname);
  const scope = shellScope(path);
  const overview = overviewTarget(scope);
  const settings = path.endsWith('/settings') || path === routes.settings;
  const workspaceChild = /^\/organizations\/[^/]+\/workspaces\/[^/]+\/.+/.test(path) && !settings;
  return [
    { key: 'overview', label: 'Overview', to: overview, current: path === overview },
    {
      key: 'workspaces',
      label: 'Workspaces',
      to: scope.organizationId ? routes.organization(scope.organizationId) : routes.organizations,
      current: workspaceChild,
    },
    { key: 'engines', label: 'Engines', to: routes.engines, current: path === routes.engines },
    { key: 'settings', label: 'Settings', to: settingsTarget(scope), current: settings },
    { key: 'docs', label: 'Docs', to: routes.reference, current: path === routes.reference },
  ];
}
