import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { VerifiedExportDownload } from './VerifiedDownload.js';
import type { ExportJob } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import type { StatusTone } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState } from '../../components/States.js';
import { Table, Td } from '../../components/Table.js';
import { exportTerminalStates, reasonText, sizeText } from './prepare.js';
import { useExportWrite } from './useWrite.js';
import './exports.css';

type Scope = { organizationId: string; workspaceId: string };
const revisionReads = 32;
const tones: Record<ExportJob['state'], StatusTone> = {
  queued: 'info',
  dispatching: 'running',
  generating: 'running',
  publishing: 'running',
  ready: 'pass',
  failed: 'fail',
  cancelled: 'skipped',
  unknown: 'neutral',
};
const stateLabels: Record<ExportJob['state'], string> = {
  queued: 'Queued',
  dispatching: 'Sent',
  generating: 'Generating',
  publishing: 'Checking',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};
const columns = [
  { key: 'revision', label: 'Suite revision' },
  { key: 'state', label: 'Status' },
  { key: 'result', label: 'Result' },
  { key: 'size', label: 'Size', numeric: true },
  { key: 'requested', label: 'Requested' },
  { key: 'action', label: <span className="sr-only">Action</span> },
];
const when = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function resultText(job: ExportJob): string {
  if (job.state === 'ready') return `${job.artifact?.name ?? 'suite.js'}, plain k6 script`;
  if (job.state === 'unknown') return 'Not confirmed; storage stays reserved';
  if (job.state === 'failed') return reasonText(job.reason) || 'Failed';
  return exportTerminalStates.includes(job.state) ? '—' : 'Building the script';
}

/** Suite names (one page) and revision ordinals (bounded) for the rows on this page. */
function useLabels(scope: Scope, jobs: readonly ExportJob[]) {
  const api = useApi();
  const { organizationId, workspaceId } = scope;
  const suites = useQuery({
    queryKey: [...queryKeys.suites(organizationId, workspaceId), 'exports-names'],
    queryFn: ({ signal }) => readResult(api.listSuites({ params: scope, query: { limit: 100 }, signal })),
  });
  const ids = [...new Set(jobs.map((job) => job.revisionId.toLowerCase()))].slice(0, revisionReads);
  const revisions = useQueries({
    queries: ids.map((revisionId) => ({
      queryKey: queryKeys.suiteRevision(organizationId, workspaceId, revisionId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readResult(api.getSuiteRevision({ params: { ...scope, revisionId }, signal })),
    })),
  });
  return (job: ExportJob) => {
    const suite = suites.data?.items.find((item) => item.id.toLowerCase() === job.suiteId.toLowerCase());
    const ordinal = revisions[ids.indexOf(job.revisionId.toLowerCase())]?.data?.ordinal;
    return `${suite?.name ?? 'Suite'} · ${ordinal ? `revision ${ordinal}` : 'saved revision'}`;
  };
}

function RowAction({ job }: { job: ExportJob }) {
  const write = useExportWrite();
  const params = { organizationId: job.scope.organizationId, workspaceId: job.scope.workspaceId, exportId: job.id };
  if (job.state === 'ready' && job.artifact)
    return <VerifiedExportDownload job={job} label="Download" variant="text" size="sm" />;
  if (!exportTerminalStates.includes(job.state))
    return (
      <Button
        variant="text"
        size="sm"
        disabled={job.cancellationRequested || write.pending || write.unknown || write.id !== null}
        onClick={() =>
          void write.send({ kind: 'cancel', params, body: { scope: job.scope, requestId: crypto.randomUUID() } })
        }
      >
        {job.cancellationRequested ? 'Cancelling…' : 'Cancel'}
      </Button>
    );
  return (
    <Link
      className={buttonClass('text', 'sm')}
      to={routes.suiteScript(job.scope.organizationId, job.scope.workspaceId, job.suiteId, job.revisionId)}
    >
      Details
    </Link>
  );
}

function Rows({ scope, jobs }: { scope: Scope; jobs: readonly ExportJob[] }) {
  const label = useLabels(scope, jobs);
  return (
    <Table caption="Script exports" columns={columns}>
      {jobs.map((job) => (
        <tr key={job.id}>
          <Td>{label(job)}</Td>
          <Td>
            <Status tone={tones[job.state]}>{stateLabels[job.state]}</Status>
          </Td>
          <Td muted={job.state !== 'ready'}>{resultText(job)}</Td>
          <Td numeric>{job.artifact ? sizeText(job.artifact.bytes) : '—'}</Td>
          <Td>{when(job.requestedAt)}</Td>
          <Td>
            <RowAction job={job} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** "Exports" workspace tab: script exports of every suite revision, newest first as the API pages them. */
export function WorkspaceExports(scope: Scope) {
  const api = useApi();
  const root = queryKeys.exports(scope.organizationId, scope.workspaceId);
  const page = usePage(root);
  const listing = useQuery({
    queryKey: [...root, 'page', page.cursor],
    queryFn: ({ signal }) => readResult(api.listExports({ params: scope, query: page.query, signal })),
    refetchInterval: (query) =>
      query.state.status !== 'error' && query.state.data?.items.some((job) => !exportTerminalStates.includes(job.state))
        ? 2000
        : false,
  });
  return (
    <section className="content-section" aria-label="Exports">
      <p className="exports-intro">
        Scripts exported from suite revisions. Each one runs with plain k6, without Beetle. Start an export from a suite
        revision. Suites that use secrets can’t be exported.
      </p>
      <QueryState query={listing}>
        {(data) =>
          data.items.length ? (
            <>
              <Rows scope={scope} jobs={data.items} />
              <Pagination page={page} next={data.nextCursor} />
            </>
          ) : (
            <EmptyState title="No exports yet" compact>
              Open a suite revision’s script and choose Export script.
            </EmptyState>
          )
        }
      </QueryState>
    </section>
  );
}
