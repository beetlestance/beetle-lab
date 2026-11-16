import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CancelRunRequest } from '@beetle/contracts/api';
import { errorMessage, unknownOutcome, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import type { RunScope } from './types.js';

/** One retained cancellation intent; retirement fences callbacks, never proves stop. */
export function useCancellation(scope: RunScope & { runId: string }) {
  const api = useApi(); const client = useQueryClient();
  const owner = useRef({ active: true, busy: false, controller: new AbortController() });
  const original = useRef<CancelRunRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { organizationId, workspaceId, runId } = scope;
  useEffect(() => {
    const current = { active: true, busy: false, controller: new AbortController() };
    owner.current = current; original.current = null;
    setPending(false); setUnknown(false); setAccepted(false); setMessage(null);
    return () => { current.active = false; current.controller.abort(); };
  }, [api, organizationId, workspaceId, runId]);

  async function request() {
    const current = owner.current;
    if (!current.active || current.busy || accepted) return;
    original.current ??= { scope: { kind: 'workspace', organizationId, workspaceId }, requestId: crypto.randomUUID() };
    const body = original.current;
    current.busy = true; current.controller = new AbortController();
    setPending(true); setUnknown(false); setMessage(null);
    let reply;
    try { reply = await api.cancelRun({ params: { organizationId, workspaceId, runId }, body, signal: current.controller.signal }); }
    catch { reply = { ok: false as const, error: { kind: 'transport' as const } }; }
    if (!current.active) return;
    current.busy = false; setPending(false);
    if (!reply.ok) {
      const uncertain = unknownOutcome(reply.error); setUnknown(uncertain);
      setMessage(uncertain ? 'Cancellation outcome is unknown. Refresh the run or retry the same request.' : errorMessage(reply.error));
      return;
    }
    setAccepted(true);
    // A receipt replay can be stale; re-read instead of seeding detail from it.
    void client.invalidateQueries({ queryKey: queryKeys.runs(organizationId, workspaceId) });
  }
  return { pending, unknown, accepted, message, request };
}
