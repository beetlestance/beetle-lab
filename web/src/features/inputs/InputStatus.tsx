import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { InputParams, InputRecord } from '@beetle/contracts/api';
import { ApiFailure, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Status } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { DeletionDialog, DeletionRefusal } from './DeletionDialog.js';
import { InputUsage } from './Usage.js';
import { formatBytes, formatDate, inputStatus, plural } from './format.js';
import { useDeletion } from './useDeletion.js';

export function InputStatus({
  params,
  close,
  ...actions
}: {
  params: InputParams;
  close: () => void;
  renderActions?: (record: InputRecord) => ReactNode;
}) {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.input(params.organizationId, params.workspaceId, params.inputId);
  const identity = JSON.stringify(key);
  const readEpoch = useRef(0);
  const [actionRecord, setActionRecord] = useState<InputRecord | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const epoch = readEpoch.current;
      const record = await readResult(api.getInput({ params, signal }));
      if (!signal.aborted && epoch === readEpoch.current) setActionRecord(record);
      return record;
    },
  });
  const refresh = async () => {
    await query.refetch();
    await client.invalidateQueries({
      queryKey: [...queryKeys.inputs(params.organizationId, params.workspaceId), 'pages'],
    });
  };
  const deletion = useDeletion(params, refresh, () => {
    readEpoch.current++;
    setActionRecord(null);
  });
  useEffect(
    () => () => {
      const prefix = JSON.parse(identity) as string[];
      void client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: prefix });
    },
    [client, identity],
  );
  const deleted = query.data?.state === 'deleted';
  return (
    <section className="input-status" aria-label="Current input status">
      <header className="section-header">
        <h2>{query.data?.name ?? 'Current input status'}</h2>
        <div className="actions">
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Refresh current status
          </Button>
          <Button
            size="sm"
            variant="text"
            disabled={deletion.phase === 'pending' || (deletion.locked && !deleted)}
            onClick={close}
          >
            Close current status
          </Button>
        </div>
      </header>
      <StatusRead query={query} deletion={deletion} />
      <CurrentActions query={query} record={actionRecord} pending={deletion.phase === 'pending'} {...actions} />
      {query.data && !!query.data.usedByCount && <InputUsage params={params} count={query.data.usedByCount} />}
      <DeletionStatus deletion={deletion} deleted={deleted} />
      <DeletionDialog deletion={deletion} record={query.data} />
    </section>
  );
}

function CurrentActions({
  query,
  record,
  pending,
  renderActions,
}: {
  query: UseQueryResult<InputRecord>;
  record: InputRecord | null;
  pending: boolean;
  renderActions?: (record: InputRecord) => ReactNode;
}) {
  if (pending || !query.isSuccess || query.isFetching || !record || !renderActions) return null;
  return (
    <div className="actions" key={record.id}>
      {renderActions(record)}
    </div>
  );
}

function StatusRead({
  query,
  deletion,
}: {
  query: UseQueryResult<InputRecord>;
  deletion: ReturnType<typeof useDeletion>;
}) {
  if (query.data === undefined) return <QueryState query={query}>{() => null}</QueryState>;
  const input = query.data;
  const blocked = query.isFetching || query.isError || input.state === 'deleted' || input.state === 'deleting';
  return (
    <>
      {query.isError && (
        <p role="alert" className="banner banner-danger">
          {query.error instanceof ApiFailure ? query.error.message : 'Could not refresh current status.'} Showing the
          last read status.
        </p>
      )}
      <InputMetadata input={input} />
      {deletion.phase === 'idle' && (
        <Button variant="danger" size="sm" disabled={blocked} onClick={() => deletion.prepare(input)}>
          Delete input
        </Button>
      )}
    </>
  );
}

function InputMetadata({ input }: { input: InputRecord }) {
  const status = inputStatus(input);
  const added = formatDate(input.createdAt);
  const published = formatDate(input.publishedAt);
  return (
    <dl className="input-metadata">
      <dt>Name</dt>
      <dd>{input.name}</dd>
      <dt>Status</dt>
      <dd>
        <Status tone={status.tone}>{status.label}</Status>
      </dd>
      <dt>Size</dt>
      <dd className="number">
        {formatBytes(input.bytes)}
        {input.bytes >= 1000 && <span className="muted"> ({input.bytes.toLocaleString('en-US')} bytes)</span>}
      </dd>
      {typeof input.rowCount === 'number' && (
        <>
          <dt>Rows</dt>
          <dd className="number">{plural(input.rowCount, 'row')}</dd>
        </>
      )}
      {typeof input.columnCount === 'number' && (
        <>
          <dt>Columns</dt>
          <dd className="number">{plural(input.columnCount, 'column')}</dd>
        </>
      )}
      {added && (
        <>
          <dt>Added</dt>
          <dd>{added}</dd>
        </>
      )}
      {published && (
        <>
          <dt>Published</dt>
          <dd>{published}</dd>
        </>
      )}
      <dt>Committed progress</dt>
      <dd>
        <progress aria-label="Committed input bytes" max={input.bytes || 1} value={input.offset} />
        <span className="number">
          {' '}
          {input.offset} / {input.bytes} bytes
        </span>
      </dd>
      <dt>Version</dt>
      <dd className="number">{input.version}</dd>
      <dt>SHA256</dt>
      <dd className="number">{input.sha256}</dd>
      {input.reason && (
        <>
          <dt>Failure reason</dt>
          <dd>{reasonText[input.reason]}</dd>
        </>
      )}
      {input.state === 'deleting' && (
        <>
          <dt>Cleanup</dt>
          <dd>Deleting. Storage release is not yet confirmed.</dd>
        </>
      )}
      {input.state === 'deleted' && (
        <>
          <dt>Cleanup</dt>
          <dd>Deleted. The backend has confirmed absence.</dd>
        </>
      )}
    </dl>
  );
}

const reasonText = {
  custody_missing: 'Stored input bytes are missing.',
  integrity: 'Input integrity verification failed.',
  io: 'Storage cleanup or access failed.',
  unverified_legacy: 'Legacy input bytes have not been verified.',
} as const;

function DeletionStatus({ deletion, deleted }: { deletion: ReturnType<typeof useDeletion>; deleted: boolean }) {
  const { phase, failure } = deletion;
  if (phase === 'idle' || phase === 'confirm' || phase === 'pending' || phase === 'rejected') return null;
  return (
    <div className="input-deletion">
      {deletion.accepted && (
        <p role="status">Deletion accepted (202). Current status determines whether cleanup has finished.</p>
      )}
      {failure && <DeletionRefusal failure={failure} unknown={phase === 'unknown'} />}
      {!deleted && (
        <div className="actions">
          <Button size="sm" onClick={() => void deletion.submit()}>
            Replay identical deletion
          </Button>
        </div>
      )}
      {deletion.locked && !deleted && (
        <p>Keep this status panel open to retain the deletion request. Refresh status or replay explicitly.</p>
      )}
    </div>
  );
}
