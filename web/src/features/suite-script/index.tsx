import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ExportJob, Suite, SuiteRevision, SuiteRevisionSummary } from '@beetle/contracts/api';
import { ApiFailure, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { NotFound } from '../../components/NotFound.js';
import { QueryState } from '../../components/QueryState.js';
import { TabPanel, Tabs } from '../../components/Tabs.js';
import { ExportDialog } from '../exports/ExportDialog.js';
import { maximumShownScriptBytes, readScript } from '../exports/scriptText.js';
import { useRevisionExport } from '../exports/useRevisionExport.js';
import { savedWhen } from '../suite-editor/ConflictDialog.js';
import { StartRun } from '../suite-overview/index.js';
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

/** The ready script's text, read once through the verified content route. */
function useScriptText(revision: SuiteRevision, job: ExportJob | undefined) {
  const { organizationId, workspaceId } = revision.scope;
  const readable = job?.state === 'ready' && !!job.artifact && job.artifact.bytes <= maximumShownScriptBytes;
  return useQuery({
    queryKey: [...queryKeys.export(organizationId, workspaceId, job?.id ?? ''), 'content'],
    enabled: readable,
    queryFn: ({ signal }) => readScript(job!, signal),
    retry: false,
    staleTime: Infinity,
  });
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
      {(revision.message || saved) && (
        <p className="script-description">
          {revision.message && <span>{revision.message}</span>}
          {savedSeparator(revision.message, saved)}
          {saved && <span>{saved}</span>}
        </p>
      )}
      {copied && (
        <p role="status" className="script-note">
          {copied}
        </p>
      )}
    </>
  );
}

/**
 * "Run this revision": the suite page's Start run dialog with this revision chosen. Hidden
 * until the workspace name (which the dialog shows) has been read.
 */
function RunRevision({
  suite,
  revision,
  revisions,
}: {
  suite: Suite;
  revision: SuiteRevision;
  revisions: readonly SuiteRevisionSummary[];
}) {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const [open, setOpen] = useState(false);
  const workspace = useQuery({
    queryKey: queryKeys.workspace(organizationId, workspaceId),
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params: { organizationId, workspaceId }, signal })),
  });
  if (!workspace.data) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Run this revision</Button>
      {open && (
        <StartRun
          suite={suite}
          workspaceName={workspace.data.name}
          revisions={revisions}
          initialRevisionId={revision.id}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScriptPage({ suite, revision }: { suite: Suite; revision: SuiteRevision }) {
  const { organizationId, workspaceId } = revision.scope;
  const [tab, setTab] = useState<Tab>('script');
  const [exporting, setExporting] = useState(false);
  const flow = useRevisionExport(revision);
  const comparison = useComparison(suite, revision);
  const script = useScriptText(revision, flow.job);
  const suiteHref = routes.suite(organizationId, workspaceId, suite.id);
  const counts = comparison.diff ? `+${comparison.diff.added} −${comparison.diff.removed}` : undefined;
  return (
    <section className="content-section script-page">
      <nav className="script-crumbs" aria-label="Breadcrumb">
        <Link to={suiteHref}>← {suite.name}</Link>
      </nav>
      <ScriptHeader
        revision={revision}
        text={script.data}
        exportScript={() => setExporting(true)}
        run={<RunRevision suite={suite} revision={revision} revisions={comparison.choices} />}
      />
      <Tabs<Tab>
        label="Script views"
        idBase="script"
        selected={tab}
        onSelect={setTab}
        items={[
          { id: 'script', label: 'Script' },
          { id: 'changes', label: 'Changes', count: counts },
        ]}
      />
      <TabPanel idBase="script" id={tab}>
        {tab === 'script' ? (
          <ScriptTab revision={revision} flow={flow} script={script} open={() => setExporting(true)} />
        ) : (
          <ChangesTab comparison={comparison} />
        )}
      </TabPanel>
      {exporting && (
        <ExportDialog
          revision={revision}
          suiteName={suite.name}
          flow={flow}
          close={() => setExporting(false)}
          editHref={suiteHref}
        />
      )}
    </section>
  );
}

/** "Script / revision N" with its Changes and One column variants, for one saved suite revision. */
export function SuiteScript({ organizationId, workspaceId, suiteId, revisionId }: SuiteScriptScope) {
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
  if (missing(suite.error) || missing(revision.error)) return <NotFound kind="script" back={back} />;
  if (revision.data && revision.data.suiteId.toLowerCase() !== suiteId.toLowerCase())
    return <NotFound kind="script" back={back} />;
  return (
    <QueryState query={suite}>
      {(suiteData) => (
        <QueryState query={revision}>
          {(revisionData) => <ScriptPage key={revisionData.id} suite={suiteData} revision={revisionData} />}
        </QueryState>
      )}
    </QueryState>
  );
}
