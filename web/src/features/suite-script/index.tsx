import { ScriptNamespace } from './ScriptNamespace.js';
import { ScriptBreadcrumbs } from './ScriptBreadcrumbs.js';
import { useSessionAccess } from '../../app/session.js';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Suite, SuiteRevision, SuiteRevisionSummary, Workspace } from '@beetle/contracts/api';
import { ApiFailure, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { NotFound } from '../../components/NotFound.js';
import { AuthoringState } from '../suites/AuthoringState.js';
import { TabPanel } from '../../components/Tabs.js';
import { ExportDialog } from '../exports/ExportDialog.js';
import { useScriptText } from './script-read.js';
import { useRevisionExport } from '../exports/useRevisionExport.js';
import { savedWhen } from '../suite-editor/ConflictDialog.js';
import { StartRun } from '../suite-overview/index.js';
import { ScriptTabs } from './ComparisonControls.js';
import type { Layout } from './comparison-model.js';
import { ChangesTab } from './ChangesTab.js';
import { ScriptTab } from './ScriptTab.js';
import { useComparison } from './useComparison.js';
import './script.css';

export type SuiteScriptScope = { organizationId: string; workspaceId: string; suiteId: string; revisionId: string };
type Tab = 'script' | 'changes';

const missing = (error: unknown) => error instanceof ApiFailure && error.failure.protocol?.code === 'not_found';

/** "Saved Nov 6, 14:10 by Meera; 2 runs used it." with each part only when the API gives it. */
function savedLine(revision: SuiteRevision): string {
  const saved = savedWhen(revision.savedAt, revision.savedBy);
  const runs = revision.runCount;
  const used = runs === undefined ? '' : `${runs.toLocaleString('en-US')} ${runs === 1 ? 'run' : 'runs'} used it.`;
  if (saved && used) return `Saved ${saved}; ${used}`;
  return saved ? `Saved ${saved}.` : used;
}

function savedSeparator(message: string | null | undefined, saved: string) {
  if (!message || !saved) return '';
  return /[.!?。！？]$/.test(message.trimEnd()) ? ' ' : '. ';
}

function ScriptHeader({
  revision,
  text,
  exportScript,
  run,
}: {
  revision: SuiteRevision;
  text: string | undefined;
  exportScript: () => void;
  run: ReactNode;
}) {
  const [copied, setCopied] = useState('');
  const saved = savedLine(revision);
  const copy = () =>
    navigator.clipboard?.writeText(text!).then(
      () => setCopied('Script copied.'),
      () => setCopied('Copying is not available here.'),
    ) ?? setCopied('Copying is not available here.');
  return (
    <>
      <header className="script-header">
        <div>
          <h1>Script for revision {revision.ordinal}</h1>
        </div>
        <div className="script-actions">
          {run}
          <Button disabled={text === undefined} onClick={copy}>
            Copy script
          </Button>
          <Button variant="primary" onClick={exportScript}>
            Export script
          </Button>
        </div>
      </header>
      <p className="script-description">
        {revision.message && <span>{revision.message}</span>}
        {savedSeparator(revision.message, saved)}
        {saved && <span>{saved}</span>}
        {!revision.message && !saved && 'Saved details were not recorded.'}
      </p>
      {copied && (
        <p role="status" className="script-note">
          {copied}
        </p>
      )}
    </>
  );
}

/**
 * "Run this revision": uses the verified workspace name and is disabled in restored history.
 */
function RunRevision({
  suite,
  revision,
  revisions,
  workspaceName,
}: {
  suite: Suite;
  revision: SuiteRevision;
  revisions: readonly SuiteRevisionSummary[];
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const { readOnly } = useSessionAccess();
  return (
    <>
      <Button disabled={readOnly} onClick={() => setOpen(true)}>
        Run this revision
      </Button>
      {open && (
        <StartRun
          suite={suite}
          workspaceName={workspaceName}
          revisions={revisions}
          initialRevisionId={revision.id}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function useCurrentScript(revision: SuiteRevision) {
  const flow = useRevisionExport(revision);
  const script = useScriptText(revision.scope, revision, flow.job);
  return {
    flow,
    script,
    current: {
      job: flow.job,
      text: script,
      pending: flow.listing.isPending || (flow.create.id !== null && flow.detail.isPending),
      failed: flow.listing.isError || flow.detail.isError || script.isError,
    },
    retry: () => {
      void flow.listing.refetch({ cancelRefetch: false });
      if (flow.detail.isError) void flow.detail.refetch({ cancelRefetch: false });
      if (script.isError) void script.refetch();
    },
  };
}

function ScriptPage({ suite, revision, workspace }: { suite: Suite; revision: SuiteRevision; workspace: Workspace }) {
  const { organizationId, workspaceId } = revision.scope;
  const [tab, setTab] = useState<Tab>('script');
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useSearchParams();
  const zip = search.get('export') === 'zip';
  function closeExport() {
    setExporting(false);
    if (zip) {
      const next = new URLSearchParams(search);
      next.delete('export');
      setSearch(next, { replace: true });
    }
  }
  const [layout, setLayout] = useState<Layout>('split');
  const { flow, script, current, retry } = useCurrentScript(revision);
  const comparison = useComparison(suite, revision, current, retry);
  const suiteHref = routes.suite(organizationId, workspaceId, suite.id);
  return (
    <section className="content-section script-page">
      <ScriptBreadcrumbs suite={suite} revision={revision} workspace={workspace} choices={comparison.choices} />
      <ScriptHeader
        revision={revision}
        text={script.data}
        exportScript={() => setExporting(true)}
        run={
          <RunRevision
            suite={suite}
            revision={revision}
            revisions={comparison.choices}
            workspaceName={workspace.name}
          />
        }
      />
      <ScriptTabs
        tab={tab}
        select={setTab}
        comparison={comparison}
        layout={layout}
        setLayout={setLayout}
        suite={suite}
      />
      <TabPanel idBase="script" id={tab}>
        {tab === 'script' ? (
          <ScriptTab revision={revision} flow={flow} script={script} open={() => setExporting(true)} />
        ) : (
          <ChangesTab
            comparison={comparison}
            layout={layout}
            revision={revision}
            openCurrent={() => setExporting(true)}
          />
        )}
      </TabPanel>
      {(exporting || zip) && (
        <ExportDialog
          revision={revision}
          suiteName={suite.name}
          flow={flow}
          close={closeExport}
          zip={zip}
          editHref={suiteHref}
        />
      )}
    </section>
  );
}

/** "Script / revision N" with its Changes and One column variants, for one saved suite revision. */
function ScopedScript({
  organizationId,
  workspaceId,
  suiteId,
  revisionId,
  workspace,
}: SuiteScriptScope & { workspace: Workspace }) {
  const api = useApi();
  const suite = useQuery({
    queryKey: queryKeys.suite(organizationId, workspaceId, suiteId),
    queryFn: ({ signal }) => readResult(api.getSuite({ params: { organizationId, workspaceId, suiteId }, signal })),
  });
  const revision = useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, revisionId),
    queryFn: ({ signal }) =>
      readResult(api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId }, signal })),
  });
  const back = { to: routes.suites(organizationId, workspaceId), label: 'Back to suites' };
  if ((!suite.data && missing(suite.error)) || (!revision.data && missing(revision.error)))
    return <NotFound kind="script" back={back} />;
  if (revision.data && revision.data.suiteId.toLowerCase() !== suiteId.toLowerCase())
    return <NotFound kind="script" back={back} />;
  return (
    <AuthoringState query={suite} retainedLabel="Your script and export controls are kept.">
      {(suiteData) => (
        <AuthoringState query={revision} retainedLabel="Your script and export controls are kept.">
          {(revisionData) => (
            <ScriptPage key={revisionData.id} suite={suiteData} revision={revisionData} workspace={workspace} />
          )}
        </AuthoringState>
      )}
    </AuthoringState>
  );
}

/** Resolve the namespace before reading script owners; scope changes retire the complete feature. */
export function SuiteScript(props: SuiteScriptScope) {
  return (
    <ScriptNamespace
      key={`${props.organizationId}/${props.workspaceId}`}
      organizationId={props.organizationId}
      workspaceId={props.workspaceId}
    >
      {(workspace) => <ScopedScript {...props} workspace={workspace} />}
    </ScriptNamespace>
  );
}
