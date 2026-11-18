import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Run, RunHistorySummary, RunListContext, RunPage } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import { Dialog } from '../../../components/Dialog.js';
import { Pagination, usePage } from '../../../components/Pagination.js';
import { SegmentedFilter } from '../../../components/SegmentedFilter.js';
import { formatDuration, formatNumber, formatTime, runStatus, shortId } from '../../run-results/format.js';
import { HeaderIcon } from '../live/HeaderIcon.js';
import { terminal } from '../terminal.js';
import './compare-picker.css';

export function ResultCompare({ run, suiteName }: { run: Run; suiteName: string | undefined }) {
  const [open, setOpen] = useState(false);
  if (!terminal(run)) return null;
  return (
    <>
      <Button aria-label="Compare" title="Compare" className="result-compare-action" onClick={() => setOpen(true)}>
        <HeaderIcon kind="compare" />
      </Button>
      {open && <ComparePicker run={run} suiteName={suiteName} onClose={() => setOpen(false)} />}
    </>
  );
}

function ComparePicker({ run, suiteName, onClose }: { run: Run; suiteName: string | undefined; onClose(): void }) {
  const [filter, setFilter] = useState<'suite' | 'all'>('suite');
  return (
    <Dialog
      className="result-compare-dialog"
      title={`Compare run ${shortId(run.id)} with`}
      description={`The run you pick becomes the baseline; ${shortId(run.id)} shows how far it moved.`}
      onClose={onClose}
      actions={
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Candidates key={filter} run={run} filter={filter} suiteName={suiteName} onFilter={setFilter} onClose={onClose} />
    </Dialog>
  );
}

function useCandidates(run: Run, all: boolean) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const prefix = [...queryKeys.run(organizationId, workspaceId, run.id), 'compare-picker', all ? 'all' : 'suite'];
  const page = usePage(prefix);
  const query = useQuery({
    queryKey: [...prefix, page.cursor],
    refetchOnReconnect: false,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      readResult(
        api.listRuns({
          params: { organizationId, workspaceId },
          query: { ...page.query, limit: 20, order: 'newest', ...(all ? {} : { suiteId: run.suiteId }) },
          signal,
        }),
      ),
  });
  useEffect(
    () => () => {
      const queryKey = [...queryKeys.run(organizationId, workspaceId, run.id), 'compare-picker', all ? 'all' : 'suite'];
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    },
    [client, organizationId, workspaceId, run.id, all],
  );
  return { page, query };
}

type CandidateProps = {
  run: Run;
  filter: 'suite' | 'all';
  suiteName: string | undefined;
  onFilter(value: 'suite' | 'all'): void;
  onClose(): void;
};
function Candidates({ run, filter, suiteName, onFilter, onClose }: CandidateProps) {
  const all = filter === 'all';
  const { page, query } = useCandidates(run, all);
  const data = query.isError ? undefined : query.data;
  const candidates = candidateItems(data, run);
  const previous = previousCandidate(candidates, run, !all && page.position === 1);
  return (
    <>
      <SegmentedFilter
        label="Comparison candidates"
        value={filter}
        onChange={onFilter}
        options={[
          {
            value: 'suite',
            label: suiteName ?? 'This suite',
            count: knownSuiteCount(data, candidates, { all, first: page.position === 1 }),
          },
          { value: 'all', label: 'Every suite' },
        ]}
      />
      {query.isPending && <p role="status">Reading runs…</p>}
      {query.isError && (
        <div role="alert">
          <p>Runs could not be loaded.</p>
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry candidate runs
          </Button>
        </div>
      )}
      {data && (
        <>
          {candidates.length === 0 ? (
            <p>No finished, cancelled or errored runs on this page to compare with.</p>
          ) : (
            <ul className="result-compare-list">
              {candidates.map((item) => (
                <Candidate
                  key={item.run.id}
                  current={run}
                  item={item}
                  previous={item.run.id === previous}
                  onClose={onClose}
                />
              ))}
            </ul>
          )}
          {(page.hasBack || data.nextCursor) && (
            <Pagination page={page} next={data.nextCursor} order="newest" label="Candidate run pages" limit={20} />
          )}
        </>
      )}
    </>
  );
}

function candidateItems(data: RunPage | undefined, current: Run): CandidateItem[] {
  if (!data) return [];
  return data.items.flatMap((run, index) => {
    if (!terminal(run) || run.id.toLowerCase() === current.id.toLowerCase()) return [];
    return [{ run, summary: data.summaries[index]!, context: data.contexts?.[index] }];
  });
}

function previousCandidate(candidates: readonly CandidateItem[], current: Run, firstSuitePage: boolean) {
  if (!firstSuitePage) return undefined;
  return candidates.find((item) => older(item.run, current))?.run.id;
}

function older(candidate: Run, current: Run): boolean {
  return (
    candidate.requestedAt < current.requestedAt ||
    (candidate.requestedAt === current.requestedAt && candidate.id.toLowerCase() < current.id.toLowerCase())
  );
}

type CandidateItem = { run: Run; summary: RunHistorySummary; context: RunListContext | undefined };
function Candidate({
  current,
  item,
  previous,
  onClose,
}: {
  current: Run;
  item: CandidateItem;
  previous: boolean;
  onClose(): void;
}) {
  const run = item.run;
  const status = runStatus(run);
  const sameSuite = run.suiteId.toLowerCase() === current.suiteId.toLowerCase();
  const p95 = item.summary.httpP95;
  return (
    <li>
      <Link
        onClick={onClose}
        to={routes.comparison(current.scope.organizationId, current.scope.workspaceId, [run.id, current.id])}
      >
        <span className="result-compare-row">
          <span>
            {previous && <span className="result-previous">Previous</span>}run {shortId(run.id)},{' '}
            {item.context ? `revision ${item.context.revisionOrdinal}` : 'revision number not recorded'}
            {!sameSuite && <span className="result-compare-sub">{item.context?.suiteName ?? 'Another suite'}</span>}
            {sameSuite && run.revisionId.toLowerCase() !== current.revisionId.toLowerCase() && (
              <span className="result-compare-revision"> (different revision)</span>
            )}
          </span>
          <Status tone={status.tone}>{status.label}</Status>
        </span>
        <span className="result-compare-row result-compare-sub">
          <span>
            {formatTime(run.requestedAt)}
            {item.summary.testDurationMs !== null ? `, ${formatDuration(item.summary.testDurationMs)}` : ''}
          </span>
          <span>{p95 ? `p95 ≈ ${formatNumber(p95.estimate)} ms` : 'p95 —'}</span>
        </span>
      </Link>
    </li>
  );
}

/** A count is exact only when the entire filtered list fits on the first page. */
function knownSuiteCount(
  data: RunPage | undefined,
  items: readonly CandidateItem[],
  position: { all: boolean; first: boolean },
): number | undefined {
  return !position.all && position.first && data?.nextCursor === null ? items.length : undefined;
}
