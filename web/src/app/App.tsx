import { lazy, Suspense, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import type { ApiClient } from '@beetle/contracts/api';
import { ApiContext } from './api.js';
import { createQueryClient } from './queries.js';
import { routes, validId } from './routes.js';
import { EditorProvider } from '../components/Editor.js';
import { ThemePicker } from '../components/ThemePicker.js';

const Organizations = lazy(() => import('../features/organizations/index.js').then(module => ({ default: module.Organizations })));
const OrganizationScope = lazy(() => import('../features/workspaces/index.js').then(module => ({ default: module.OrganizationScope })));

const Suites = lazy(() => import('../features/suites/index.js').then(module => ({ default: module.Suites })));
const Settings = lazy(() => import('../features/settings/index.js').then(module => ({ default: module.Settings })));

/** Router is supplied by the host: BrowserRouter in production, MemoryRouter in tests. */
export function App({ apiClient }: { apiClient: ApiClient }) {
  const [client] = useState(createQueryClient);
  return <ApiContext.Provider value={apiClient}><QueryClientProvider client={client}>
    <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar"><Link className="wordmark" to={routes.organizations}><span className="brand-mark" aria-hidden="true">b.</span>beetle<span className="wordmark-detail">lab</span></Link>
        <p className="sidebar-caption">Local performance testing</p>
        <nav aria-label="Main navigation"><Link className="sidebar-link" to={routes.organizations}>Organizations <span aria-hidden="true">↗</span></Link><Link className="sidebar-link" to={routes.settings}>Installation settings</Link></nav>
        <div className="sidebar-bottom"><span>Appearance</span><ThemePicker /></div>
      </aside>
      <main id="main" tabIndex={-1}><div className="topbar"><span>Namespace browser</span><span>Beetle Lab</span></div>
        <EditorProvider><div className="page-content"><Suspense fallback={<p role="status">Loading view…</p>}>
          <Routes>
            <Route path={routes.inputsPattern} element={<ScopeRoute view="inputs" />} />
            <Route path={routes.suitesPattern} element={<SuitesRoute />} />
            <Route path={routes.suitePattern} element={<SuitesRoute />} />
            <Route path={routes.settings} element={<Settings scope={{ kind: 'installation' }} />} />
            <Route path={routes.organizationSettingsPattern} element={<SettingsRoute />} />
            <Route path={routes.workspaceSettingsPattern} element={<SettingsRoute />} />
            <Route path={routes.organizations} element={<Organizations />} />
            <Route path={routes.organizationPattern} element={<ScopeRoute />} />
            <Route path={routes.workspacePattern} element={<ScopeRoute />} />
            <Route path="*" element={<InvalidRoute />} />
          </Routes>
        </Suspense></div></EditorProvider>
      </main>
    </div>
  </QueryClientProvider></ApiContext.Provider>;
}
function ScopeRoute({ view }: { view?: 'inputs' }) {
  const { organizationId, workspaceId } = useParams();
  if (!validId(organizationId) || (workspaceId !== undefined && !validId(workspaceId))
    || (view === 'inputs' && !validId(workspaceId))) return <InvalidRoute />;
  return <OrganizationScope key={organizationId} organizationId={organizationId}
    {...(workspaceId ? { workspaceId } : {})} {...(view ? { view } : {})} />;
}
function InvalidRoute() {
  return <section className="notice"><h1>Page not found</h1><p>This namespace address is invalid.</p><Link to={routes.organizations}>View organizations</Link></section>;
}

function SettingsRoute() {
  const { organizationId, workspaceId } = useParams();
  if (!validId(organizationId) || (workspaceId !== undefined && !validId(workspaceId))) return <InvalidRoute />;
  const scope = workspaceId ? { kind: 'workspace' as const, organizationId, workspaceId }
    : { kind: 'organization' as const, organizationId };
  return <Settings key={JSON.stringify(scope)} scope={scope} />;
}

function SuitesRoute() {
  const { organizationId, workspaceId, suiteId } = useParams();
  if (!validId(organizationId) || !validId(workspaceId) || (suiteId !== undefined && !validId(suiteId))) return <InvalidRoute />;
  return <Suites key={`${organizationId}/${workspaceId}/${suiteId ?? ''}`} organizationId={organizationId} workspaceId={workspaceId} {...(suiteId ? { suiteId } : {})} />;
}
