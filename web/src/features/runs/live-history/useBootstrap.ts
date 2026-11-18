import { useEffect, useRef, useState } from 'react';
import type { LiveMetricHistory, RunAttemptParams } from '@beetle/contracts/api';
import { historyReads } from './read.js';
import type { HistoryReads } from './read.js';
export interface BootstrapState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  retry(): void;
}
/** First ready feed/reconnect only, never each metrics poll; no automatic expensive retry. */
export function useHistoryBootstrap(
  params: RunAttemptParams,
  trigger: object | null,
  enabled: boolean,
  accept: (value: LiveMetricHistory) => void,
  reads: Pick<HistoryReads, 'read'> = historyReads,
): BootstrapState {
  const last = useRef<object | null>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const [status, setStatus] = useState<BootstrapState['status']>('idle');
  const [retry, setRetry] = useState(0);
  const retryRef = useRef(0);
  const { organizationId, workspaceId, runId, attemptId } = params;
  useEffect(() => {
    if (!enabled || !trigger) {
      setStatus((old) => (old === 'loading' ? 'idle' : old));
      return;
    }
    if (last.current === trigger && retryRef.current === retry) return;
    const controller = new AbortController();
    let active = true;
    setStatus('loading');
    const timer = setTimeout(() => {
      active = false;
      controller.abort();
      setStatus('unavailable');
    }, 30000);
    void Promise.resolve()
      .then(() => {
        if (!active || controller.signal.aborted) throw Error();
        last.current = trigger;
        retryRef.current = retry;
        return reads.read({ params: { organizationId, workspaceId, runId, attemptId }, signal: controller.signal });
      })
      .then(
        (value) => {
          if (!active || controller.signal.aborted) return;
          clearTimeout(timer);
          try {
            acceptRef.current(value);
            setStatus('ready');
          } catch {
            setStatus('unavailable');
          }
        },
        () => {
          clearTimeout(timer);
          if (active) setStatus('unavailable');
        },
      );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [organizationId, workspaceId, runId, attemptId, trigger, enabled, retry, reads]);
  return { status, retry: () => setRetry((value) => value + 1) };
}
