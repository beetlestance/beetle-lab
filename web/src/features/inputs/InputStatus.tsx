import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { InputParams, InputRecord } from '@beetle/contracts/api';
import { ApiFailure, errorMessage, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { QueryState } from '../../components/QueryState.js';
import { useDeletion } from './useDeletion.js';

export function InputStatus({ params, close, ...actions }: {
  params: InputParams; close: () => void; renderActions?: (record: InputRecord) => ReactNode;
}) {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.input(params.organizationId, params.workspaceId, params.inputId);
  const identity = JSON.stringify(key);
  const readEpoch = useRef(0);
  const [actionRecord, setActionRecord] = useState<InputRecord | null>(null);
  const query = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const epoch = readEpoch.current;
    const record = await readResult(api.getInput({ params, signal }));
    if (!signal.aborted && epoch === readEpoch.current) setActionRecord(record);
    return record;
  } });
  const refresh = async () => {
    await query.refetch();
    await client.invalidateQueries({ queryKey: [...queryKeys.inputs(params.organizationId, params.workspaceId), 'pages'] });
  };
  const deletion = useDeletion(params, refresh, () => { readEpoch.current++; setActionRecord(null); });
  useEffect(() => () => {
    const prefix = JSON.parse(identity) as string[];
    void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix });
  }, [client, identity]);
  const deleted = query.data?.state === 'deleted';
  return <section className="input-status" aria-label="Current input status">
    <header className="section-header"><h2>Current input status</h2><div className="actions">
      <button disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh current status</button>
      <button disabled={deletion.phase === 'pending' || (deletion.locked && !deleted)} onClick={close}>Close current status</button>
    </div></header>
    <StatusRead query={query} deletion={deletion} />
    <CurrentActions query={query} record={actionRecord} {...actions} />
    <DeletionStatus deletion={deletion} deleted={deleted} />
  </section>;
}

function CurrentActions({ query, record, renderActions }: {
  query: UseQueryResult<InputRecord>; record: InputRecord | null; renderActions?: (record: InputRecord) => ReactNode;
}) {
  if (!query.isSuccess || query.isFetching || !record || !renderActions) return null;
  return <div className="actions" key={record.id}>{renderActions(record)}</div>;
}

function StatusRead({ query, deletion }: { query: UseQueryResult<InputRecord>; deletion: ReturnType<typeof useDeletion> }) {
  if (query.data === undefined) return <QueryState query={query}>{() => null}</QueryState>;
  const input = query.data;
  const blocked = query.isFetching || query.isError || input.state === 'deleted' || input.state === 'deleting';
  return <>
    {query.isError && <p role="alert" className="notice error">
      {query.error instanceof ApiFailure ? query.error.message : 'Could not refresh current status.'} Showing the last read status.</p>}
    <InputMetadata input={input} />
    {deletion.phase === 'idle' && <button disabled={blocked} onClick={() => deletion.prepare(input)}>Delete input</button>}
  </>;
}

function InputMetadata({ input }: { input: InputRecord }) {
  return <dl className="input-metadata">
    <dt>Name</dt><dd>{input.name}</dd><dt>State</dt><dd>{input.state}</dd>
    <dt>Size</dt><dd className="number">{input.bytes} bytes</dd>
    <dt>Committed progress</dt><dd><progress aria-label="Committed input bytes" max={input.bytes || 1} value={input.offset} />
      <span className="number"> {input.offset} / {input.bytes} bytes</span></dd>
    <dt>Version</dt><dd className="number">{input.version}</dd>
    <dt>SHA256</dt><dd className="number">{input.sha256}</dd>
    {input.reason && <><dt>Failure reason</dt><dd>{reasonText[input.reason]}</dd></>}
    {input.state === 'deleting' && <><dt>Cleanup</dt><dd>Deleting. Storage release is not yet confirmed.</dd></>}
    {input.state === 'deleted' && <><dt>Cleanup</dt><dd>Deleted. The backend has confirmed absence.</dd></>}
  </dl>;
}

const reasonText = {
  custody_missing: 'Stored input bytes are missing.', integrity: 'Input integrity verification failed.',
  io: 'Storage cleanup or access failed.', unverified_legacy: 'Legacy input bytes have not been verified.',
} as const;

function DeletionStatus({ deletion, deleted }: { deletion: ReturnType<typeof useDeletion>; deleted: boolean }) {
  const { phase, intent } = deletion;
  return <div className="input-deletion">
    {phase === 'confirm' && <div role="group" aria-label="Confirm input deletion" className="notice">
      <p>Delete this input at version {intent?.body.expectedVersion}? Retained suite revisions may prevent deletion.</p>
      <div className="actions"><button onClick={() => void deletion.submit()}>Confirm deletion</button>
        <button onClick={deletion.discard}>Cancel deletion</button></div>
    </div>}
    {phase === 'pending' && <p role="status">Submitting deletion…</p>}
    {deletion.accepted && <p role="status">Deletion accepted (202). Current status determines whether cleanup has finished.</p>}
    <DeletionFailure deletion={deletion} />
    <ReplayDeletion deletion={deletion} deleted={deleted} />
    {deletion.locked && !deleted && <p>Keep this status panel open to retain the deletion request. Refresh status or replay explicitly.</p>}
  </div>;
}

function DeletionFailure({ deletion }: { deletion: ReturnType<typeof useDeletion> }) {
  const { failure, phase } = deletion;
  if (!failure) return null;
  return <div role="alert" className="notice error"><p>{errorMessage(failure)}</p>
    {failure.protocol?.code === 'protected_dependency' && <p>Retained references protect this input from deletion.</p>}
    {failure.protocol?.code === 'conflict' && <p>The version or deletion intent conflicts. Refresh current status before deciding what to do.</p>}
    {phase === 'unknown' && <p>The request outcome is unknown. Its original identity and version are retained.</p>}
  </div>;
}

function ReplayDeletion({ deletion, deleted }: { deletion: ReturnType<typeof useDeletion>; deleted: boolean }) {
  if (deleted || !['unknown', 'accepted', 'rejected'].includes(deletion.phase)) return null;
  return <div className="actions">
    <button onClick={() => void deletion.submit()}>Replay identical deletion</button>
    {deletion.phase === 'rejected' && <button onClick={deletion.discard}>Clear rejected deletion</button>}
  </div>;
}
