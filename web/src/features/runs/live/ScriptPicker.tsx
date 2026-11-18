import { Link } from 'react-router-dom';
import type { Run, Suite, SuiteRevision, SuiteRevisionSummary } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import { Badge } from '../../../components/Badge.js';
import { Dialog } from '../../../components/Dialog.js';
import { useRevisions } from './data.js';
import { when } from '../../suite-overview/status.js';
import './script-picker.css';

type Choice = SuiteRevisionSummary | SuiteRevision;
type RowProps = { run: Run; suite: Suite | undefined; revision: Choice; onClose(): void };
/** One bounded history page plus the run's already verified immutable revision. */
export function ScriptPicker({
  run,
  suite,
  runRevision,
  onClose,
}: {
  run: Run;
  suite: Suite | undefined;
  runRevision: SuiteRevision | undefined;
  onClose(): void;
}) {
  const query = useRevisions(run, true);
  const page = [...(query.data?.items ?? [])].sort((a, b) => b.ordinal - a.ordinal);
  const missing = !page.some((item) => item.id.toLowerCase() === run.revisionId.toLowerCase());
  const items = missing && runRevision ? [runRevision, ...page] : page;
  const href = routes.suiteScriptFromRun(
    run.scope.organizationId,
    run.scope.workspaceId,
    run.suiteId,
    run.revisionId,
    run.id,
  );
  return (
    <Dialog
      className="script-picker-dialog"
      title={suite ? `Scripts for ${suite.name}` : 'Scripts for this suite'}
      description="Pick a revision to read its script. The next screen also shows what changed against another revision."
      onClose={onClose}
      actions={
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ScriptPageState query={query} />
      {missing && !runRevision && (
        <p>
          <Link to={href} onClick={onClose}>
            Open this run’s saved script
          </Link>
        </p>
      )}
      {items.length > 0 && (
        <ul className="live-picker">
          {items.map((revision) => (
            <ScriptRow key={revision.id} run={run} suite={suite} revision={revision} onClose={onClose} />
          ))}
        </ul>
      )}
      <MoreRevisions
        hasNext={!!query.data?.nextCursor}
        count={page.length}
        injected={items.length > page.length}
        href={routes.suitePage(run.scope.organizationId, run.scope.workspaceId, run.suiteId, { tab: 'revisions' })}
        onClose={onClose}
      />
    </Dialog>
  );
}
function ScriptRow({ run, suite, revision, onClose }: RowProps) {
  const current = revision.id.toLowerCase() === run.revisionId.toLowerCase();
  const latest = revision.id.toLowerCase() === suite?.currentRevisionId?.toLowerCase();
  return (
    <li>
      <Link
        to={routes.suiteScriptFromRun(
          run.scope.organizationId,
          run.scope.workspaceId,
          run.suiteId,
          revision.id,
          run.id,
        )}
        onClick={onClose}
        aria-current={current ? 'true' : undefined}
      >
        <span className="live-picker-main">
          <span className="live-picker-title">
            Revision {revision.ordinal}
            {current && <Badge tone="amber">This run</Badge>}
            {latest && <Badge>Latest</Badge>}
          </span>
          <span className="live-picker-date" title={revision.savedAt ?? undefined}>
            {savedTime(revision.savedAt)}
          </span>
        </span>
        <span className="live-picker-meta">
          <span className="live-picker-message" title={revision.message ?? undefined}>
            {revision.message || 'No revision note'}
          </span>
          <span className="live-picker-usage">{savedInfo(revision)}</span>
        </span>
      </Link>
    </li>
  );
}

function ScriptPageState({ query }: { query: ReturnType<typeof useRevisions> }) {
  if (query.isPending) return <p role="status">Loading revisions…</p>;
  if (!query.isError) return null;
  return (
    <div role="alert">
      <p>Revisions could not be loaded. Previously read immutable details are retained.</p>
      <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
        Retry revisions
      </Button>
    </div>
  );
}
function MoreRevisions({
  hasNext,
  count,
  injected,
  href,
  onClose,
}: {
  hasNext: boolean;
  count: number;
  injected: boolean;
  href: string;
  onClose(): void;
}) {
  if (!hasNext) return null;
  return (
    <p className="live-note">
      Showing {count} saved revisions from this page{injected ? ', plus this run’s revision' : ''}.{' '}
      <Link to={href} onClick={onClose}>
        All saved revisions
      </Link>
    </p>
  );
}
function savedInfo(revision: Choice): string {
  const count =
    revision.runCount === undefined
      ? 'Run count not recorded'
      : `${revision.runCount} ${revision.runCount === 1 ? 'run' : 'runs'}`;
  return revision.savedBy ? `${count}, by ${revision.savedBy}` : count;
}
function savedTime(value: string | null | undefined): string {
  if (!value) return 'Date not recorded';
  const text = when(value);
  return text === 'Unknown time' ? value : text;
}
