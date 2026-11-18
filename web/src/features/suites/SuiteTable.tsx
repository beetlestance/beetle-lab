import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Suite, SuiteListSummary, SuitePage } from '@beetle/contracts/api';
import { useSessionAccess } from '../../app/session.js';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Table, Td } from '../../components/Table.js';
import type { PlanSummary } from '../suite-overview/index.js';
import { clock, engineLabel, groupText, planSummary, runStatus, when } from '../suite-overview/index.js';

/** Suite rows for a folder or a workspace search. Latest run comes inline from `summaries`. */
export function SuiteTable({
  page,
  caption,
  start,
}: {
  page: SuitePage;
  caption: string;
  start: (suite: Suite) => void;
}) {
  const summaries = new Map((page.summaries ?? []).map((summary) => [summary.suiteId.toLowerCase(), summary]));
  return (
    <Table
      caption={caption}
      className="suite-table"
      columns={[
        { key: 'suite', label: 'Suite' },
        { key: 'engine', label: 'Engine' },
        { key: 'plan', label: 'Plan' },
        { key: 'revision', label: 'Revision' },
        { key: 'last', label: 'Last run' },
        { key: 'action', label: <span className="sr-only">Actions</span> },
      ]}
    >
      {page.items.map((suite) => (
        <SuiteRow key={suite.id} suite={suite} summary={summaries.get(suite.id.toLowerCase())} start={start} />
      ))}
    </Table>
  );
}
function SuiteRow({
  suite,
  summary,
  start,
}: {
  suite: Suite;
  summary: SuiteListSummary | undefined;
  start: (suite: Suite) => void;
}) {
  const { organizationId, workspaceId } = suite.scope;
  const { readOnly } = useSessionAccess();
  return (
    <tr>
      <Td>
        <Link className="suite-name" to={routes.suite(organizationId, workspaceId, suite.id)}>
          {suite.name}
        </Link>
        {suite.description && <span className="suite-subline">{suite.description}</span>}
      </Td>
      <Td>{summary ? engineLabel(summary.engineId) : suite.currentRevisionId ? 'Unknown' : 'No revision'}</Td>
      <RevisionCells suite={suite} />
      <Td>
        <LastRun suite={suite} summary={summary} />
      </Td>
      <Td>
        <Button
          size="sm"
          disabled={readOnly || !suite.currentRevisionId}
          onClick={() => start(suite)}
          aria-label={`Start run of ${suite.name}`}
        >
          Start run
        </Button>
      </Td>
    </tr>
  );
}
function LastRun({ suite, summary }: { suite: Suite; summary: SuiteListSummary | undefined }) {
  if (!summary) return <span className="muted">Unknown</span>;
  const latest = summary.latestRun;
  if (!latest)
    return (
      <>
        <span className="muted">{groupText.no_runs.label}</span>
        <span className="suite-subline">—</span>
      </>
    );
  const status = runStatus(latest);
  return (
    <>
      <Link
        to={routes.run(suite.scope.organizationId, suite.scope.workspaceId, latest.runId)}
        aria-label={`${status.label}, latest run of ${suite.name}`}
      >
        <Status tone={status.tone}>{status.label}</Status>
      </Link>
      <time className="suite-subline" dateTime={latest.requestedAt}>
        {when(latest.requestedAt)}
      </time>
    </>
  );
}
/** "10:00 total, 5 requests" */
function planFacts(plan: PlanSummary): string {
  const count = plan.requestCount;
  return [
    plan.totalMs === null ? 'length depends on the target' : `${clock(plan.totalMs)} total`,
    count === null ? null : `${count} ${count === 1 ? 'request' : 'requests'}`,
  ]
    .filter(Boolean)
    .join(', ');
}
/** Plan and revision columns read the suite's current revision (immutable, cached per revision). */
function RevisionCells({ suite }: { suite: Suite }) {
  const api = useApi();
  const { organizationId, workspaceId } = suite.scope;
  const revisionId = suite.currentRevisionId ?? '';
  const query = useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, revisionId),
    enabled: revisionId !== '',
    queryFn: async ({ signal }) => {
      const result = await readResult(
        api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId }, signal }),
      );
      if (result.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return result;
    },
  });
  const plan = useMemo(() => (query.data ? planSummary(query.data.config) : null), [query.data]);
  if (!revisionId)
    return (
      <>
        <Td muted>No saved revision</Td>
        <Td muted>—</Td>
      </>
    );
  if (!query.data || !plan)
    return (
      <>
        <Td muted>{query.isError ? 'Unknown' : 'Reading…'}</Td>
        <Td muted>{query.isError ? 'Unknown' : ''}</Td>
      </>
    );
  return (
    <>
      <Td>
        {plan.first?.label ?? 'Plan unavailable'}
        <span className="suite-subline">{planFacts(plan)}</span>
      </Td>
      <Td>
        <span className="number">{query.data.ordinal}</span>
        {query.data.savedAt && (
          <time className="suite-subline" dateTime={query.data.savedAt}>
            {when(query.data.savedAt)}
          </time>
        )}
      </Td>
    </>
  );
}
