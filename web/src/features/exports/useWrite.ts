import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ApiClientFailure,
  CancelExportRequest,
  CreateExportRequest,
  CreateRunExportRequest,
  ExportParams,
  RunParams,
} from '@beetle/contracts/api';
import { useApi, errorMessage, unknownOutcome } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
export type ExportAction =
  | { kind: 'create'; body: CreateExportRequest }
  | { kind: 'createRun'; params: RunParams; body: CreateRunExportRequest }
  | { kind: 'cancel'; params: ExportParams; body: CancelExportRequest };
/** Unknown replies retain exactly one frozen intent; retirement ignores late replies. */
export function useExportWrite() {
  const api = useApi();
  const client = useQueryClient();
  const owner = useRef({ active: true, busy: false, abort: new AbortController() });
  const original = useRef<ExportAction | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiClientFailure | null>(null);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const current = { active: true, busy: false, abort: new AbortController() };
    owner.current = current;
    original.current = null;
    return () => {
      current.active = false;
      current.abort.abort();
    };
  }, [api]);
  async function send(action?: ExportAction) {
    const current = owner.current;
    if (!current.active || current.busy) return;
    const captured = action ?? original.current;
    if (!captured) return;
    original.current = structuredClone(captured);
    current.busy = true;
    current.abort = new AbortController();
    setPending(true);
    setFailure(null);
    let reply;
    try {
      reply = await sendAction(api, captured, current.abort.signal);
    } catch {
      reply = { ok: false as const, error: { kind: 'transport' as const } };
    }
    if (!current.active) return;
    current.busy = false;
    setPending(false);
    if (!reply.ok) {
      setFailure(reply.error);
      return;
    }
    original.current = null;
    setId(reply.value.id);
    void client.invalidateQueries({
      queryKey: queryKeys.exports(captured.body.scope.organizationId, captured.body.scope.workspaceId),
    });
  }
  return {
    send,
    id,
    pending,
    unknown: failure !== null && unknownOutcome(failure),
    message: failure ? errorMessage(failure) : null,
  };
}

function sendAction(api: ReturnType<typeof useApi>, action: ExportAction, signal: AbortSignal) {
  if (action.kind === 'createRun') return api.createRunExport({ params: action.params, body: action.body, signal });
  if (action.kind === 'cancel') return api.cancelExport({ params: action.params, body: action.body, signal });
  const { organizationId, workspaceId } = action.body.scope;
  const params = { organizationId, workspaceId, revisionId: action.body.revisionId };
  return api.createExport({ params, body: action.body, signal });
}
