import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RunAttemptParams } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { LivePosition } from './position.js';
import { LiveMetricStale, liveMetricReads } from './read.js';
import type { LiveFrame, LiveMetricReads } from './read.js';
export type LiveState = {readonly owner: object; readonly status: 'loading' | 'unavailable' | 'stale' | 'paused'}
  | {readonly owner: object; readonly status: 'ready'; readonly value: LiveFrame};
const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible';
const subscribe = (change: () => void) => {document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change);};
interface Owner {readonly params: RunAttemptParams; readonly reads: Pick<LiveMetricReads, 'read'>;
  readonly position: LivePosition; pending?: Promise<LiveFrame>; resume?: () => void}
export function useLiveMetrics(params: RunAttemptParams, enabled: boolean, reads: Pick<LiveMetricReads, 'read'> = liveMetricReads): LiveState {
  const api = useApi(); const isVisible = useSyncExternalStore(subscribe, visible, () => false);
  const {organizationId, workspaceId, runId, attemptId} = params;
  const owner = useMemo<Owner>(() => ({params: {organizationId, workspaceId, runId, attemptId}, reads, position: new LivePosition()}),
    [api, reads, organizationId, workspaceId, runId, attemptId]);
  const lease = useMemo(() => ({owner}), [owner, enabled, isVisible]);
  const [state, setState] = useState<LiveState>({owner: lease, status: 'loading'});
  useEffect(() => {
    if (!enabled || !isVisible) return;
    let active = true; const controller = new AbortController();
    let scheduled: ReturnType<typeof setTimeout> | undefined; let expiry: ReturnType<typeof setTimeout> | undefined;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && !controller.signal.aborted;
    const update = (next: LiveState) => {if (current()) setState(next);};
    const resume = () => {clearTimeout(waiting); if (current()) void poll();};
    async function poll(): Promise<void> {
      if (owner.pending) {
        owner.resume = resume;
        waiting = setTimeout(() => update({owner: lease, status: 'unavailable'}), 5000);
        return;
      }
      if (!current()) return;
      const call = new AbortController(); const started = performance.now();
      const signal = AbortSignal.any([controller.signal, call.signal]);
      const deadline = setTimeout(() => {call.abort(); update({owner: lease, status: 'unavailable'});}, 5000);
      const work = Promise.resolve().then(() => {
        if (!current()) throw new Error('Live metric read retired');
        return owner.reads.read({params: owner.params, signal});
      });
      owner.pending = work;
      try {
        const reply = await work;
        if (!current()) return;
        checkReply(call.signal, started);
        const value = owner.position.accept(reply, performance.now());
        clearTimeout(expiry); update({owner: lease, status: 'ready', value});
        expiry = setTimeout(() => update({owner: lease, status: 'stale'}), Math.max(0, value.expiresAtMono - performance.now()));
      } catch (error) {if (current()) {clearTimeout(expiry); update({owner: lease, status: error instanceof LiveMetricStale ? 'stale' : 'unavailable'});}}
      finally {
        clearTimeout(deadline);
        if (owner.pending === work) {
          delete owner.pending; const wake = owner.resume; delete owner.resume; wake?.();
        }
        if (current()) scheduled = setTimeout(() => {void poll();}, 2000);
      }
    }
    update({owner: lease, status: 'loading'}); void poll();
    return () => {
      active = false; controller.abort(); clearTimeout(scheduled); clearTimeout(expiry); clearTimeout(waiting);
      if (owner.resume === resume) delete owner.resume;
    };
  }, [owner, lease, enabled, isVisible]);
  if (!enabled || !isVisible) return {owner: lease, status: 'paused'};
  if (state.owner !== lease) return {owner: lease, status: 'loading'};
  return state.status === 'ready' && performance.now() >= state.value.expiresAtMono ? {owner: lease, status: 'stale'} : state;
}

function checkReply(signal: AbortSignal, started: number): void {
  const now = performance.now();
  if (signal.aborted || !Number.isFinite(now) || now < started || now - started >= 5000) throw new Error('Live metric read expired');
}
