import { useLayoutEffect, useMemo, useState } from 'react';
import type { ApiClientFailure, InputRecord, InputTransferClient, InputTransferFailure } from '@beetle/contracts/api';
import { errorMessage, useInputTransfers } from '../../app/api.js';
import './input-download.css';

const MAX_BYTES = 8 * 1024 * 1024;
const GENERAL_FAILURE = 'Could not download this input. Try again.';
type Phase = 'idle' | 'pending' | 'cancelling' | 'cancelled' | 'ready' | 'error';
interface Owner { active: boolean; controller: AbortController | null; url: string | null }
interface State { owner: Owner; phase: Phase; error: string | null }

export function InputDownload({ record }: { record: InputRecord }) {
  const client = useInputTransfers();
  if (!client || record.state !== 'published') return null;
  const filename = `input-${record.id.toLowerCase()}.bin`;
  if (!/^input-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.bin$/.test(filename)) return null;
  const identity = JSON.stringify([record.id, record.scope.kind, record.scope.organizationId,
    record.scope.workspaceId, record.folderId, record.name, record.sha256, record.bytes,
    record.offset, record.version, record.state, record.reason]);
  return <DownloadControl key={identity} record={record} client={client} filename={filename} />;
}

function DownloadControl({ record, client, filename }: {
  record: InputRecord; client: InputTransferClient; filename: string;
}) {
  const download = useDownload(record, client);
  const pending = ['pending', 'cancelling'].includes(download.phase);
  return <div className="input-download" role="group" aria-label="Download published input">
    <div className="actions">
      <button disabled={pending} onClick={() => void download.start()}>
        {['error', 'cancelled'].includes(download.phase) ? 'Retry download' : 'Download input'}
      </button>
      {pending && <button disabled={download.phase === 'cancelling'} onClick={download.cancel}>Cancel download</button>}
      {download.url && <a href={download.url} download={filename}>Save file</a>}
    </div>
    {pending && <p role="status">{download.phase === 'cancelling' ? 'Cancelling download…' : 'Verifying input download…'}</p>}
    {download.phase === 'cancelled' && <p role="status">Download cancelled.</p>}
    {download.phase === 'ready' && <p role="status">Verified input is ready to save.</p>}
    {download.error && <p role="alert" className="notice error">{download.error}</p>}
  </div>;
}

function useDownload(record: InputRecord, client: InputTransferClient) {
  const owner = useMemo<Owner>(() => ({ active: true, controller: null, url: null }), [client]);
  const [state, setState] = useState<State>({ owner, phase: 'idle', error: null });
  useLayoutEffect(() => {
    owner.active = true;
    return () => { owner.active = false; owner.controller?.abort(); revoke(owner); };
  }, [owner]);
  const update = (phase: Phase, error: string | null = null) => setState({ owner, phase, error });
  const start = async () => {
    if (!owner.active || owner.controller) return;
    const controller = new AbortController();
    owner.controller = controller;
    revoke(owner);
    update('pending');
    try {
      const result = await client.download({ record, signal: controller.signal });
      if (!usable(owner, controller)) return;
      if (!result.ok) { update('error', failureMessage(result.error)); return; }
      const blob = boundedBlob(result.value, record.bytes);
      owner.url = URL.createObjectURL(blob);
      update('ready');
    } catch {
      if (usable(owner, controller)) update('error', GENERAL_FAILURE);
    } finally {
      owner.controller = null;
      if (owner.active && controller.signal.aborted) update('cancelled');
    }
  };
  const cancel = () => {
    if (!owner.controller || owner.controller.signal.aborted) return;
    owner.controller.abort();
    update('cancelling');
  };
  const visible = state.owner === owner ? state : { phase: 'idle' as const, error: null };
  return { ...visible, url: owner.url, start, cancel };
}

function usable(owner: Owner, controller: AbortController): boolean {
  return owner.active && !controller.signal.aborted;
}

function revoke(owner: Owner) {
  if (owner.url === null) return;
  URL.revokeObjectURL(owner.url);
  owner.url = null;
}

function boundedBlob(content: Uint8Array, expected: number): Blob {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_BYTES) throw new Error(GENERAL_FAILURE);
  if (!(content instanceof Uint8Array) || content.byteLength !== expected) throw new Error(GENERAL_FAILURE);
  // A bounded standalone buffer avoids retaining an adapter's larger backing buffer.
  const buffer = new ArrayBuffer(expected);
  new Uint8Array(buffer).set(content);
  return new Blob([buffer], { type: 'application/octet-stream' });
}

function failureMessage(failure: InputTransferFailure): string {
  if (isApiFailure(failure)) return errorMessage(failure);
  return failure.kind === 'busy'
    ? 'Input transfers are busy. Try again when the current transfer finishes.'
    : 'Input transfers are unavailable. Reconnect before trying again.';
}

function isApiFailure(failure: InputTransferFailure): failure is ApiClientFailure {
  return failure.kind !== 'busy' && failure.kind !== 'closed';
}
