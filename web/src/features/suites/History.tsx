import { useSessionAccess } from '../../app/session.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Suite, SuiteRevisionSummary } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Badge } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState } from '../../components/States.js';
import { changeList } from '../suite-overview/changes.js';
import { when } from '../suite-overview/index.js';
import './revision-list.css';

/** First page of a suite's revisions; the Suite header and the Revisions tab share it. */
export function useRevisionPage(suite: Suite, cursor = '', limit = 100) {
  const api = useApi();
  const params = {
    organizationId: suite.scope.organizationId,
    workspaceId: suite.scope.workspaceId,
    suiteId: suite.id,
  };
  return useQuery({
    queryKey: [...queryKeys.suiteRevisions(params.organizationId, params.workspaceId, suite.id), String(limit), cursor],
    queryFn: ({ signal }) =>
      readResult(api.listSuiteRevisions({ params, query: { limit, ...(cursor ? { cursor } : {}) }, signal })),
  });
}
/** Suite / Revisions: eight at a time, with message, stamps, run count and visible changes. */
export function History({ suite, run }: { suite: Suite; run: (revisionId: string) => void }) {
  const key = queryKeys.suiteRevisions(suite.scope.organizationId, suite.scope.workspaceId, suite.id);
  const page = usePage(key);
  const query = useRevisionPage(suite, page.cursor, 8);
  return (
    <section aria-label="Revisions">
      <QueryState query={query}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState compact title="No revisions yet">
              Save the first revision on the Edit tab. Runs always use the revision that made them.
            </EmptyState>
          ) : (
            <>
              <ol className="revision-list">
                {data.items.map((revision) => (
                  <RevisionItem key={revision.id} suite={suite} revision={revision} run={run} />
                ))}
              </ol>
              {(page.hasBack || data.nextCursor) && <Pagination page={page} next={data.nextCursor} limit={8} />}
            </>
          )
        }
      </QueryState>
    </section>
  );
}
function RevisionItem({
  suite,
  revision,
  run,
}: {
  suite: Suite;
  revision: SuiteRevisionSummary;
  run: (revisionId: string) => void;
}) {
  const { readOnly } = useSessionAccess();
  const previous = revision.previousRevisionId;
  const latest = revision.id.toLowerCase() === suite.currentRevisionId?.toLowerCase();
  return (
    <li className="revision-item">
      <div className="revision-head">
        <h2 className="revision-title">
          Revision {revision.ordinal} {latest && <Badge>Latest</Badge>}
        </h2>
        <p className="revision-message">{revision.message ?? 'No revision message recorded.'}</p>
        <p className="muted">{bylineOf(revision)}</p>
      </div>
      <div className="revision-delta">
        {revision.ordinal === 1 ? (
          <ul className="revision-changes">
            <li>First revision</li>
          </ul>
        ) : previous ? (
          <Changes suite={suite} before={previous} after={revision.id} />
        ) : (
          <p className="muted">No previous revision recorded.</p>
        )}
      </div>
      <div className="revision-actions">
        <Link
          className={buttonClass('text', 'sm')}
          to={routes.suiteScript(suite.scope.organizationId, suite.scope.workspaceId, suite.id, revision.id)}
        >
          View script
        </Link>
        <Button
          size="sm"
          disabled={readOnly}
          onClick={() => run(revision.id)}
          aria-label={`Run revision ${revision.ordinal}`}
        >
          Run this revision
        </Button>
      </div>
    </li>
  );
}
/** Actual save provenance and retained run count; absent historical facts stay explicit. */
function bylineOf(revision: SuiteRevisionSummary): string {
  const at = revision.savedAt ? when(revision.savedAt) : 'Save time not recorded';
  const author = revision.savedBy ? `by ${revision.savedBy}` : 'author not recorded';
  const count = revision.runCount;
  const runs =
    count === undefined
      ? 'Run count unavailable.'
      : `${count.toLocaleString('en-US')} ${count === 1 ? 'run' : 'runs'}.`;
  return `${at} ${author}. ${runs}`;
}
/** Reads the two immutable configurations (cached per revision) and lists their differences. */
function Changes({ suite, before, after }: { suite: Suite; before: string; after: string }) {
  const older = useRevision(suite, before);
  const newer = useRevision(suite, after);
  if (older.isError || newer.isError) return <p role="alert">Changes are unknown: a revision could not be read.</p>;
  if (!older.data || !newer.data) return <p role="status">Reading both revisions…</p>;
  const bullets = changeList(older.data.config, newer.data.config);
  return (
    <ul className="revision-changes" aria-label={`Changes in revision ${newer.data.ordinal}`}>
      {bullets.length ? bullets.map((text, index) => <li key={index}>{text}</li>) : <li>No configuration changes.</li>}
    </ul>
  );
}
function useRevision(suite: Suite, revisionId: string) {
  const api = useApi();
  const { organizationId, workspaceId } = suite.scope;
  return useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, revisionId),
    queryFn: async ({ signal }) => {
      const result = await readResult(
        api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId }, signal }),
      );
      if (result.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return result;
    },
  });
}
