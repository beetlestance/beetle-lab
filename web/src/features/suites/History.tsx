import { useSessionAccess } from '../../app/session.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Suite, SuiteRevisionPage, SuiteRevisionSummary } from '@beetle/contracts/api';
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

/** First page of a suite's revisions; the Suite header and the Revisions tab share it. */
export function useRevisionPage(suite: Suite, cursor = '') {
  const api = useApi();
  const params = {
    organizationId: suite.scope.organizationId,
    workspaceId: suite.scope.workspaceId,
    suiteId: suite.id,
  };
  return useQuery({
    queryKey: [...queryKeys.suiteRevisions(params.organizationId, params.workspaceId, suite.id), cursor],
    queryFn: ({ signal }) =>
      readResult(api.listSuiteRevisions({ params, query: { limit: 100, ...(cursor ? { cursor } : {}) }, signal })),
  });
}
/** Suite / Revisions: newest first, with message, author, date, run count and changes on demand. */
export function History({ suite, run }: { suite: Suite; run: (revisionId: string) => void }) {
  const key = queryKeys.suiteRevisions(suite.scope.organizationId, suite.scope.workspaceId, suite.id);
  const page = usePage(key);
  const query = useRevisionPage(suite, page.cursor);
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
                {[...data.items]
                  .sort((a, b) => b.ordinal - a.ordinal)
                  .map((revision) => (
                    <RevisionItem key={revision.id} suite={suite} revision={revision} page={data} run={run} />
                  ))}
              </ol>
              {(page.hasBack || data.nextCursor) && <Pagination page={page} next={data.nextCursor} />}
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
  page,
  run,
}: {
  suite: Suite;
  revision: SuiteRevisionSummary;
  page: SuiteRevisionPage;
  run: (revisionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { readOnly } = useSessionAccess();
  const previous = page.items.find((item) => item.ordinal === revision.ordinal - 1);
  const latest = revision.id.toLowerCase() === suite.currentRevisionId?.toLowerCase();
  return (
    <li className="revision-item">
      <div className="revision-head">
        <h2 className="revision-title">
          {revision.message ?? `Revision ${revision.ordinal}`} {latest && <Badge tone="amber">Latest</Badge>}
        </h2>
        <p className="muted">{bylineOf(revision)}</p>
      </div>
      {open && previous && <Changes suite={suite} before={previous.id} after={revision.id} />}
      <div className="revision-actions">
        {previous && (
          <Button size="sm" variant="text" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide changes' : `Changes from revision ${previous.ordinal}`}
          </Button>
        )}
        <Link
          className={buttonClass('secondary', 'sm')}
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
/** "Revision 4, saved Today, 10:02, by Meera. 3 runs" */
function bylineOf(revision: SuiteRevisionSummary): string {
  const byline = [
    `Revision ${revision.ordinal}`,
    revision.savedAt ? `saved ${when(revision.savedAt)}` : null,
    revision.savedBy ? `by ${revision.savedBy}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const runs = revision.runCount;
  if (runs === undefined) return byline;
  return `${byline}. ${runs === 1 ? '1 run' : `${runs.toLocaleString('en-US')} runs`}`;
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
