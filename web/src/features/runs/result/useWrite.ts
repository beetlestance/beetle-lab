import { useEffect, useRef, useState } from 'react';
import type { ApiClientFailure, ApiClientResult } from '@beetle/contracts/api';
import { unknownOutcome } from '../../../app/api.js';

interface Owner {
  active: boolean;
  busy: boolean;
  controller: AbortController;
  original: (() => Promise<void>) | null;
}
export type WriteFailure = { failure: ApiClientFailure; unknown: boolean };

/**
 * One explicit write at a time. The caller captures its request body (and
 * requestId) once; an unknown outcome allows only an identical replay. Unmount or a
 * new identity aborts and fences callbacks without implying rollback.
 */
export function useWrite(identity: string) {
  const owner = useRef<Owner>({ active: true, busy: false, controller: new AbortController(), original: null });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WriteFailure | null>(null);
  useEffect(() => {
    const current: Owner = { active: true, busy: false, controller: new AbortController(), original: null };
    owner.current = current;
    setPending(false);
    setError(null);
    return () => {
      current.active = false;
      current.controller.abort();
    };
  }, [identity]);
  function start<T>(
    send: (signal: AbortSignal) => Promise<ApiClientResult<T>>,
    accept: (value: T) => void,
    reject?: (failure: WriteFailure) => void,
  ): void {
    const current = owner.current;
    if (!current.active || current.busy || current.original) return;
    current.original = async () => {
      if (!current.active || current.busy) return;
      current.busy = true;
      current.controller = new AbortController();
      setPending(true);
      setError(null);
      let reply: ApiClientResult<T>;
      try {
        reply = await send(current.controller.signal);
      } catch {
        reply = { ok: false, error: { kind: 'transport' } };
      }
      if (!current.active) return;
      current.busy = false;
      setPending(false);
      if (!reply.ok) {
        const unknown = unknownOutcome(reply.error);
        setError({ failure: reply.error, unknown });
        if (!unknown) current.original = null;
        reject?.({ failure: reply.error, unknown });
        return;
      }
      current.original = null;
      accept(reply.value);
    };
    void current.original();
  }
  return {
    start,
    pending,
    error,
    retry: () => void owner.current.original?.(),
    dismiss: () => {
      if (!owner.current.original) setError(null);
    },
  };
}
export type Write = ReturnType<typeof useWrite>;
