import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Route, Routes, useParams, useLocation } from 'react-router-dom';
import type { ApiClient, InputTransferClient } from '@beetle/contracts/api';
import { ApiContext, InputTransferContext, readResult, useApi } from './api.js';
import { SessionContext, writableSession } from './session.js';
import type { SessionAccess } from './session.js';
import { createQueryClient, queryKeys } from './queries.js';
import { routes, validId } from './routes.js';
import { EditorProvider } from '../components/Editor.js';
import { LoadingState } from '../components/States.js';
import { NotFound } from '../components/NotFound.js';
import { ToastProvider } from '../components/Toast.js';
import { PageTransition } from '../components/NavigationMotion.js';
import { AppShell } from './shell/AppShell.js';
import { UpgradeWatch } from '../features/upgrade/watch.js';
import { CommandPalette, useCommandNavigation } from '../features/command-search/index.js';
import type { WorkspaceView } from '../features/workspaces/index.js';

const Home = lazy(() => import('../features/organizations/index.js').then((module) => ({ default: module.Home })));
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
      <UpgradeWatch>
      <SessionContext.Provider value={session}>
        <InputTransferContext.Provider value={inputTransfers ?? null}>
          <QueryClientProvider client={client}>
            <div inert={commands.visible} aria-hidden={commands.visible || undefined}>
              <ToastProvider>
                {/* Outside the shell: the header's organization menu opens the same editor. */}
                <EditorProvider>
                  <AppShell onSearch={commands.show}>
                    <Suspense fallback={<LoadingState label="Loading view…" />}>
                      <PageTransition>
                        <AppRoutes />
                      </PageTransition>
                    </Suspense>
                  </AppShell>
                </EditorProvider>
              </ToastProvider>
            </div>
            {commands.visible && <CommandPalette pathname={location.pathname} close={commands.close} />}
          </QueryClientProvider>
        </InputTransferContext.Provider>
      </SessionContext.Provider>
      </UpgradeWatch>
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
      <Route path={routes.workspaceSettingsPattern} element={<ScopeRoute view="settings" />} />
      <Route path={routes.workspaces} element={<Home to="workspaces" />} />
      <Route path={routes.organizationWorkspacesPattern} element={<ScopeRoute directory />} />
      <Route path={routes.organizations} element={<Home to="overview" />} />
      <Route path={routes.organizationPattern} element={<ScopeRoute />} />
      <Route path={routes.workspacePattern} element={<ScopeRoute />} />
      <Route path="*" element={<InvalidRoute />} />
    </Routes>
  );
}

function ScopeRoute({ view, directory }: { view?: WorkspaceView; directory?: boolean }) {
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

/** Organization settings; a workspace's settings are a section inside its workspace. */
function SettingsRoute() {
  const { organizationId } = useParams();
  if (!validId(organizationId)) return <InvalidRoute />;
  const scope = { kind: 'organization' as const, organizationId };
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
  return <ScopedComparison organizationId={organizationId} workspaceId={workspaceId} />;
}

/** Resolve the shell label on direct entry without gating comparison reads. */
function ScopedComparison({ organizationId, workspaceId }: { organizationId: string; workspaceId: string }) {
  const api = useApi();
  const client = useQueryClient();
  useQuery({
    queryKey: queryKeys.organization(organizationId),
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })),
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  useEffect(
    () => () => {
      client.removeQueries({ queryKey: queryKeys.organization(organizationId), exact: true, type: 'inactive' });
    },
    [client, organizationId],
  );
  return <RunComparison organizationId={organizationId} workspaceId={workspaceId} />;
}
