import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunMetricSeriesPage, RunMetricSeries, RunMetricPoint } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import type { ReadAdmission, ReadToken } from './admission.js';
interface View {items: RunMetricPoint[]; nextCursor: string | null; limited: boolean; error: boolean; busy: boolean}
const empty: View = {items: [], nextCursor: null, limited: false, error: false, busy: true};
/** Each effect captures its token; cleanup can never reactivate an earlier action. */
export function useSamples(page: RunMetricSeriesPage, series: RunMetricSeries, admission: ReadAdmission) {
  const api = useApi(); const [view, setView] = useState<View>(empty);
  const selection = useMemo(() => ({token: undefined as ReadToken | undefined}), [api, page, series.ordinal]);
  const load = useCallback(async (cursor?: string) => {
    const action = admission.run(async token => {
      const result = await collectSamples({api, page, ordinal: series.ordinal, cursor, token});
      if (result && token.current) setView({items: result.items, nextCursor: result.next ?? null,
        limited: result.next !== undefined, error: false, busy: false});
    });
    if (!action) return false;
    selection.token = action.token; setView(v => ({...v, busy: true, error: false}));
    try {await action.original;} catch {if (action.token.current) setView(v => ({...v, error: true, busy: false}));}
    return true;
  }, [api, selection, page, series.ordinal, admission]);
  useEffect(() => {
    let current = true; let started = false;
    const start = () => {if (current && !started && !admission.busy) {started = true; void load();}};
    const unsubscribe = admission.subscribe(start); start();
    return () => {current = false; unsubscribe(); const token = selection.token; if (token) admission.retire(token);};
  }, [selection, load, admission]);
  return {view, load};
}
function checkSize(items: readonly RunMetricPoint[]): void {
  if (items.length > 1000 || new TextEncoder().encode(JSON.stringify(items)).length > 1048576) throw new Error('Metric view exceeds bound');
}
function readSamples(api: ReturnType<typeof useApi>, page: RunMetricSeriesPage, ordinal: number, cursor: string | undefined, signal: AbortSignal) {
  return readResult(api.getRunMetricSamples({params: {organizationId: page.scope.organizationId,
    workspaceId: page.scope.workspaceId, runId: page.id, attemptId: page.attemptId}, query: {seriesOrdinal: ordinal,
    limit: 100, ...(cursor === undefined ? {} : {cursor})}, signal}));
}
interface SampleAction {
  api: ReturnType<typeof useApi>; page: RunMetricSeriesPage; ordinal: number; cursor: string | undefined; token: ReadToken;
}
async function collectSamples({api, page, ordinal, cursor, token}: SampleAction) {
  const items: RunMetricPoint[] = []; let next = cursor; let bytes = 2;
  for (let calls = 0; calls < 10; calls++) {
    if (!token.current) return;
    const reply = await readSamples(api, page, ordinal, next, token.signal);
    if (!token.current) return;
    if (reply.manifestDigest !== page.manifestDigest) throw new Error('Metric publication changed');
    const additional = new TextEncoder().encode(JSON.stringify(reply.items)).length - 2;
    const size = bytes + additional + (items.length && reply.items.length ? 1 : 0);
    if (size > 1048576) break;
    bytes = size; items.unshift(...reply.items); next = reply.nextCursor ?? undefined;
    if (!next) break;
  }
  checkSize(items); return {items, next};
}
