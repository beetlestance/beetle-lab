import { validateApi } from '@beetle/contracts/api';

export const routes = {
  reference: '/reference',
  engines: '/engines',
  runsPattern: '/organizations/:organizationId/workspaces/:workspaceId/runs',
  comparisonPattern: '/organizations/:organizationId/workspaces/:workspaceId/runs/compare',
  comparison: (org: string, workspace: string, ids: readonly string[]) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/runs/compare?runs=${ids.map(encodeURIComponent).join(',')}`,
  runPattern: '/organizations/:organizationId/workspaces/:workspaceId/runs/:runId',
  runs: (org: string, workspace: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/runs`,
  pinnedRuns: (org: string, workspace: string) => `${routes.runs(org, workspace)}?pinned=true`,
  run: (org: string, workspace: string, id: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(id)}`,
  inputsPattern: '/organizations/:organizationId/workspaces/:workspaceId/inputs',
  inputs: (org: string, workspace: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/inputs`,
  exportsPattern: '/organizations/:organizationId/workspaces/:workspaceId/exports',
  exports: (org: string, workspace: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/exports`,
  suitesPattern: '/organizations/:organizationId/workspaces/:workspaceId/suites',
  suitePattern: '/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId',
  suites: (org: string, workspace: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/suites`,
  newSuite: (org: string, workspace: string, view: 'form' | 'json') => `${routes.suites(org, workspace)}?new=${view}`,
  suitesFolder: (org: string, workspace: string, folderId: string) =>
    `${routes.suites(org, workspace)}?folder=${encodeURIComponent(folderId)}`,
  suite: (org: string, workspace: string, id: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/suites/${encodeURIComponent(id)}`,
  /** The suite page with a tab, editor view, open request or the Start run dialog. */
  suitePage: (org: string, workspace: string, id: string, page: SuitePage = {}) => {
    const search = suitePageSearch(page).toString();
    return `${routes.suite(org, workspace, id)}${search ? `?${search}` : ''}`;
  },
  suiteScriptPattern:
    '/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId/revisions/:revisionId/script',
  suiteScript: (org: string, workspace: string, suite: string, revision: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/suites/${encodeURIComponent(suite)}/revisions/${encodeURIComponent(revision)}/script`,
  organizations: '/',
  settings: '/settings',
  organizationSettingsPattern: '/organizations/:organizationId/settings',
  workspaceSettingsPattern: '/organizations/:organizationId/workspaces/:workspaceId/settings',
  organizationSettings: (id: string) => `/organizations/${encodeURIComponent(id)}/settings`,
  workspaceSettings: (org: string, id: string) =>
    `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(id)}/settings`,
  organizationPattern: '/organizations/:organizationId',
  workspacePattern: '/organizations/:organizationId/workspaces/:workspaceId',
  organization: (organizationId: string) => `/organizations/${encodeURIComponent(organizationId)}`,
  workspace: (organizationId: string, workspaceId: string) =>
    `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}`,
};
export const suiteTabs = ['overview', 'edit', 'revisions'] as const;
export type SuiteTab = (typeof suiteTabs)[number];
export const suiteEditorViews = ['form', 'run-setup', 'json'] as const;
export type SuiteEditorView = (typeof suiteEditorViews)[number];
/**
 * Suite page state in the URL: `?tab=edit&view=run-setup`, `&request=<id>` for one
 * request in the form view (a 1-based position when the request has no unique
 * identifier; identifiers never start with a digit), `&start=1` for Start run.
 * Overview and the form view are the defaults and are omitted.
 */
export interface SuitePage {
  tab?: SuiteTab;
  view?: SuiteEditorView;
  request?: string | null;
  start?: boolean;
}
export function suitePageSearch(page: SuitePage, base?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  const set = (name: string, value: string | null) => (value === null ? next.delete(name) : next.set(name, value));
  if (page.tab !== undefined) set('tab', page.tab === 'overview' ? null : page.tab);
  if (page.view !== undefined) {
    set('view', page.view === 'form' ? null : page.view);
    if (page.view !== 'form') next.delete('request');
  }
  if (page.request !== undefined) set('request', page.request || null);
  if (page.start !== undefined) set('start', page.start ? '1' : null);
  return next;
}
export function readSuitePage(search: URLSearchParams): Required<SuitePage> {
  const tab = search.get('tab');
  const view = search.get('view');
  const known = <T extends string>(values: readonly T[], value: string | null, fallback: T): T =>
    values.includes(value as T) ? (value as T) : fallback;
  const editorView = known(suiteEditorViews, view, 'form');
  return {
    tab: known(suiteTabs, tab, 'overview'),
    view: editorView,
    request: editorView === 'form' ? search.get('request') || null : null,
    start: search.get('start') === '1',
  };
}
export { referenceDownloads } from './reference-downloads.js';

export function validId(value: string | undefined): value is string {
  return validateApi('Uuid', value).ok;
}
