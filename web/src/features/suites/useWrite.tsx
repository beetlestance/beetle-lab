import { useEffect, useRef, useState } from 'react';
import type { ApiClientFailure, ApiClientResult } from '@beetle/contracts/api';
import { errorMessage, unknownOutcome } from '../../app/api.js';

/** A mounted scope owns one frozen attempt; retiring it aborts and ignores late replies. */
export function useWrite<T>(send: (body: T, signal: AbortSignal) => Promise<ApiClientResult<unknown>>, refresh: () => Promise<unknown>) {
  const controller = useRef(new AbortController());
  const [attempt, setAttempt] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiClientFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  async function submit(body: T) {
    if (busy.current) return;
    const active = controller.current;
    busy.current = true; setPending(true); setFailure(null); setSaved(false); setAttempt(body);
    let reply: ApiClientResult<unknown>;
    try { reply = await send(body, active.signal); }
    catch { reply = { ok: false, error: { kind: 'transport' } }; }
    if (active.signal.aborted) return;
    busy.current = false; setPending(false);
    if (!reply.ok) { setFailure(reply.error); return; }
    setAttempt(null); setSaved(true);
    await refresh();
  }
  const unknown = !!failure && unknownOutcome(failure);
  return { submit, pending, saved, failure, unknown, locked: pending || unknown,
    replay: () => { if (attempt) void submit(attempt); },
    newIntent: () => { setAttempt(null); setFailure(null); setSaved(false); } };
}
export function WriteStatus({ write, refresh }: { write: Pick<ReturnType<typeof useWrite<unknown>>, 'pending' | 'saved' | 'failure' | 'unknown' | 'replay' | 'newIntent'>; refresh: () => Promise<unknown> }) {
  return <>
    {write.pending && <p role="status">Saving…</p>}
    {write.saved && <p role="status">Saved.</p>}
    {write.failure && <div className="notice error" role="alert"><p>{errorMessage(write.failure)}</p>
      {write.unknown && <><p>The outcome is unknown. Replay sends the identical request, including its version.</p>
        <button onClick={write.replay}>Retry identical request</button>
        <button onClick={write.newIntent}>Start new intent with this draft</button></>}
      {write.failure.protocol?.code === 'conflict' && <><p>Reload the current version; your draft is preserved.</p>
        <button onClick={() => void refresh()}>Reload current version</button></>}
    </div>}
  </>;
}
