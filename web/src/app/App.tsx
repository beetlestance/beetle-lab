import { lazy, Suspense, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes, useParams, useLocation } from 'react-router-dom';
import type { ApiClient, InputTransferClient } from '@beetle/contracts/api';
import { ApiContext, InputTransferContext } from './api.js';
import { SessionContext, writableSession } from './session.js';
import type { SessionAccess } from './session.js';
import { createQueryClient } from './queries.js';
import { routes, validId } from './routes.js';
import { EditorProvider } from '../components/Editor.js';
import { LoadingState } from '../components/States.js';
import { NotFound } from '../components/NotFound.js';
import { ToastProvider } from '../components/Toast.js';
import { PageTransition } from '../components/NavigationMotion.js';
import { AppShell } from './shell/AppShell.js';
import { CommandPalette, useCommandNavigation } from '../features/command-search/index.js';

const Organizations = lazy(() =>
  import('../features/organizations/index.js').then((module) => ({ default: module.Organizations })),
);
const OrganizationScope = lazy(() =>
  import('../features/workspaces/index.js').then((module) => ({ default: module.OrganizationScope })),
);

const RunComparison = lazy(() =>
  import('../features/runs/comparison/index.js').then((module) => ({ default: module.RunComparison })),
);
const Runs = lazy(() => import('../features/runs/index.js').then((module) => ({ default: module.Runs })));
const Suites = lazy(() => import('../features/suites/index.js').then((module) => ({ default: module.Suites })));
const Settings = lazy(() => import('../features/settings/index.js').then((module) => ({ default: module.Settings })));
const Engines = lazy(() => import('../features/engines/index.js').then((module) => ({ default: module.Engines })));
const SuiteScript = lazy(() =>
  import('../features/suite-script/index.js').then((module) => ({ default: module.SuiteScript })),
);
const Reference = lazy(() =>
  import('../features/reference/index.js').then((module) => ({ default: module.Reference })),
);

/** Router is supplied by the host: BrowserRouter in production, MemoryRouter in tests. */
export function App({
  apiClient,
  inputTransfers,
  session = writableSession,
}: {
  apiClient: ApiClient;
  inputTransfers?: InputTransferClient;
  session?: SessionAccess | undefined;
}) {
  const [client] = useState(createQueryClient);
  const commands = useCommandNavigation();
  const location = useLocation();
  return (
    <ApiContext.Provider value={apiClient}>
      <SessionContext.Provider value={session}>
        <InputTransferContext.Provider value={inputTransfers ?? null}>
          <QueryClientProvider client={client}>
            <div inert={commands.visible} aria-hidden={commands.visible || undefined}>
              <ToastProvider>
                <AppShell onSearch={commands.show}>
                  <EditorProvider>
                    <Suspense fallback={<LoadingState label="Loading view…" />}>
                      <PageTransition>
                        <AppRoutes />
                      </PageTransition>
                    </Suspense>
                  </EditorProvider>
                </AppShell>
              </ToastProvider>
            </div>
            {commands.visible && <CommandPalette pathname={location.pathname} close={commands.close} />}
          </QueryClientProvider>
        </InputTransferContext.Provider>
      </SessionContext.Provider>
    </ApiContext.Provider>
  );
}
/** The route table. Every URL comes from routes.ts; each feature owns its page component. */
function AppRoutes() {
  return (
    <Routes>
      <Route path={routes.reference} element={<Reference />} />
      <Route path={routes.engines} element={<Engines />} />
      <Route path={routes.comparisonPattern} element={<ComparisonRoute />} />
      <Route path={routes.runsPattern} element={<RunsRoute />} />
      <Route path={routes.runPattern} element={<RunsRoute />} />
      <Route path={routes.inputsPattern} element={<ScopeRoute view="inputs" />} />
      <Route path={routes.exportsPattern} element={<ScopeRoute view="exports" />} />
      <Route path={routes.suitesPattern} element={<SuitesRoute />} />
      <Route path={routes.suitePattern} element={<SuitesRoute />} />
      <Route path={routes.suiteScriptPattern} element={<SuiteScriptRoute />} />
      <Route path={routes.settings} element={<Settings scope={{ kind: 'installation' }} />} />
      <Route path={routes.organizationSettingsPattern} element={<SettingsRoute />} />
      <Route path={routes.workspaceSettingsPattern} element={<SettingsRoute />} />
      <Route path={routes.workspaces} element={<Organizations workspaceDirectory />} />
      <Route path={routes.organizationWorkspacesPattern} element={<ScopeRoute directory />} />
      <Route path={routes.organizations} element={<Organizations />} />
      <Route path={routes.organizationPattern} element={<ScopeRoute />} />
      <Route path={routes.workspacePattern} element={<ScopeRoute />} />
      <Route path="*" element={<InvalidRoute />} />
    </Routes>
  );
}

function ScopeRoute({ view, directory }: { view?: 'inputs' | 'exports'; directory?: boolean }) {
  const { organizationId, workspaceId } = useParams();
  if (
    !validId(organizationId) ||
    (workspaceId !== undefined && !validId(workspaceId)) ||
    (view !== undefined && !validId(workspaceId))
  )
    return <InvalidRoute />;
  return (
    <OrganizationScope
      key={organizationId}
      organizationId={organizationId}
      directory={directory ?? false}
      {...(workspaceId ? { workspaceId } : {})}
      {...(view ? { view } : {})}
    />
  );
}
function InvalidRoute() {
  return (
    <NotFound reason="This address is not valid." back={{ to: routes.organizations, label: 'Back to overview' }} />
  );
}

function SettingsRoute() {
  const { organizationId, workspaceId } = useParams();
  if (!validId(organizationId) || (workspaceId !== undefined && !validId(workspaceId))) return <InvalidRoute />;
  const scope = workspaceId
    ? { kind: 'workspace' as const, organizationId, workspaceId }
    : { kind: 'organization' as const, organizationId };
  return <Settings key={JSON.stringify(scope)} scope={scope} />;
}

function SuitesRoute() {
  const { organizationId, workspaceId, suiteId } = useParams();
  if (!validId(organizationId) || !validId(workspaceId) || (suiteId !== undefined && !validId(suiteId)))
    return <InvalidRoute />;
  return (
    <Suites
      key={`${organizationId}/${workspaceId}/${suiteId ?? ''}`}
      organizationId={organizationId}
      workspaceId={workspaceId}
      {...(suiteId ? { suiteId } : {})}
    />
  );
}

function RunsRoute() {
  const { organizationId, workspaceId, runId } = useParams();
  if (!validId(organizationId) || !validId(workspaceId) || (runId !== undefined && !validId(runId)))
    return <InvalidRoute />;
  return (
    <Runs
      key={`${organizationId}/${workspaceId}/${runId ?? ''}`}
      organizationId={organizationId}
      workspaceId={workspaceId}
      {...(runId ? { runId } : {})}
    />
  );
}

function SuiteScriptRoute() {
  const { organizationId, workspaceId, suiteId, revisionId } = useParams();
  if (!validId(organizationId) || !validId(workspaceId) || !validId(suiteId) || !validId(revisionId))
    return <InvalidRoute />;
  return (
    <SuiteScript
      key={`${organizationId}/${workspaceId}/${suiteId}/${revisionId}`}
      organizationId={organizationId}
      workspaceId={workspaceId}
      suiteId={suiteId}
      revisionId={revisionId}
    />
  );
}

function ComparisonRoute() {
  const { organizationId, workspaceId } = useParams();
  if (!validId(organizationId) || !validId(workspaceId)) return <InvalidRoute />;
  return <RunComparison organizationId={organizationId} workspaceId={workspaceId} />;
}
