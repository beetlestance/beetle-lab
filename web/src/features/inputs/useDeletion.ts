import { useEffect, useRef, useState } from 'react';
import type { ApiClientFailure, InputParams, InputRecord, TransitionInputRequest } from '@beetle/contracts/api';
import { unknownOutcome, useApi } from '../../app/api.js';

type Phase = 'idle' | 'confirm' | 'pending' | 'accepted' | 'unknown' | 'rejected';
interface DeleteIntent { readonly inputId: string; readonly body: TransitionInputRequest }

/** Retain one frozen intent until a definitive rejection or authoritative deletion. */
export function useDeletion(params: InputParams, refresh: () => Promise<unknown>, retireActions: () => void) {
  const api = useApi();
  const controller = useRef(new AbortController());
  const intent = useRef<DeleteIntent | null>(null);
  const busy = useRef(false);
  const retained = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<ApiClientFailure | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  function prepare(input: InputRecord) {
    if (intent.current || input.state === 'deleting' || input.state === 'deleted') return;
    const scope = Object.freeze({ ...input.scope });
    intent.current = Object.freeze({ inputId: input.id,
      body: Object.freeze({ scope, requestId: crypto.randomUUID(), expectedVersion: input.version }) });
    setPhase('confirm');
  }
  function discard() {
    if (busy.current || retained.current) return;
    intent.current = null; setPhase('idle'); setFailure(null);
  }
  async function submit() {
    const attempt = intent.current;
    if (!attempt || busy.current) return;
    const active = controller.current;
    busy.current = true; setPhase('pending'); setFailure(null);
    retireActions();
    let reply;
    try {
      reply = await api.deleteInput({ params: { ...params, inputId: attempt.inputId }, body: attempt.body, signal: active.signal });
    } catch {
      reply = { ok: false as const, error: { kind: 'transport' as const } };
    }
    if (active.signal.aborted) return;
    // Reads begun during the original write cannot authorize later actions.
    retireActions();
    busy.current = false;
    if (!reply.ok) {
      retained.current ||= unknownOutcome(reply.error);
      setPhase(retained.current ? 'unknown' : 'rejected'); setFailure(reply.error);
      return;
    }
    retained.current = true; setAccepted(true); setPhase('accepted');
    await refresh();
  }
  return { phase, failure, accepted, intent: intent.current, prepare, discard, submit,
    locked: phase === 'pending' || retained.current };
}
