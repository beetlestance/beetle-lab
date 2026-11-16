import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ApiClientFailure, CreateRunRequest } from '@beetle/contracts/api';
import { useApi, unknownOutcome } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';

function failureText(failure: ApiClientFailure) {
  if (unknownOutcome(failure)) return 'The submission outcome is unknown. A run may have been queued. Check history or replay the original request.';
  switch (failure.status) {
    case 401: return 'Your session is no longer paired. Pair the browser again.';
    case 404: return 'The workspace or saved revision is unavailable.';
    case 409: return 'The request conflicts with an existing intent. Check run history.';
    default: return 'The run could not be submitted. Check the saved revision and allowed settings.';
  }
}
/** Owns one captured intent until a known reply; retirement aborts transport, not commit. */
export function useSubmission() {
  const api = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();
  const owner = useRef({ active: true, busy: false, controller: new AbortController() });
  const original = useRef<CreateRunRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiClientFailure | null>(null);
  useEffect(() => {
    const current = { active: true, busy: false, controller: new AbortController() };
    owner.current = current;
    return () => { current.active = false; current.controller.abort(); };
  }, [api]);
  async function send(body?: CreateRunRequest) {
    const current = owner.current;
    if (!current.active || current.busy) return;
    const captured = body ?? original.current;
    if (!captured) return;
    // No foreign await before capture and synchronous issuance guard.
    original.current = captured;
    current.busy = true;
    current.controller = new AbortController();
    setPending(true); setFailure(null);
    let reply;
    try {
      reply = await api.createRun({ params: { organizationId: captured.scope.organizationId, workspaceId: captured.scope.workspaceId },
        body: captured, signal: current.controller.signal });
    } catch { reply = { ok: false as const, error: { kind: 'transport' as const } }; }
    if (!current.active) return;
    current.busy = false; setPending(false);
    if (!reply.ok) { setFailure(reply.error); return; }
    const { organizationId, workspaceId } = captured.scope;
    // A replay receipt is the original version 1 snapshot, never the current detail.
    void client.invalidateQueries({ queryKey: queryKeys.runs(organizationId, workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.run(organizationId, workspaceId, reply.value.id) });
    void navigate(routes.run(organizationId, workspaceId, reply.value.id));
  }
  return { pending, unknown: failure !== null && unknownOutcome(failure),
    message: failure ? failureText(failure) : null, send,
    cancel: () => owner.current.controller.abort() };
}
