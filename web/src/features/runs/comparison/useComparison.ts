import { useEffect, useMemo, useState } from 'react';
import type {
  RunComparisonSnapshot,
  RunHistorySummary,
  RunMetricKey,
  RunMetricSeriesPage,
} from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { ReadAdmission } from '../metrics/index.js';
import type { RunScope } from '../types.js';
interface Command {
  metric: RunMetricKey | null;
  catalogue: boolean;
  cursor?: string;
}
interface View {
  snapshot?: RunComparisonSnapshot;
  page?: RunMetricSeriesPage;
  error: boolean;
  busy: boolean;
}
export type Summaries = ReadonlyMap<string, RunHistorySummary | null>;
// Physical admission outlives routes and sessions; it retains no result cache.
const comparisonAdmission = new ReadAdmission();
const initial: Command = { metric: null, catalogue: true };
const empty: View = { error: false, busy: true };
/** One admission survives render/session/selection replacement and ignored aborts. */
export function useComparison(scope: RunScope, ids: readonly string[]) {
  const api = useApi();
  const admission = comparisonAdmission;
  const owner = useMemo(() => ({}), [api, scope.organizationId, scope.workspaceId, ids.join(',')]);
  const [choice, setChoice] = useState({ owner, command: initial });
  const command = choice.owner === owner ? choice.command : initial;
  const lease = useMemo(() => ({ owner, command }), [owner, command]);
  const [saved, setSaved] = useState<{ lease: typeof lease; view: View }>();
  const [busy, setBusy] = useState(admission.busy);
  const view = saved?.lease === lease ? saved.view : empty;
  // Whole-run summaries are read with the first catalogue load and kept per selection.
  const [summaries, setSummaries] = useState<{ owner: object; value: Summaries }>();
  useEffect(() => admission.subscribe(() => setBusy(admission.busy)), [admission]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    let token: Parameters<ReadAdmission['retire']>[0] | undefined;
    /** One run's stored history summary (one exact-ID row); a failure is only a gap. */
    async function summaryOf(run: RunComparisonSnapshot['items'][number]['run'], signal: AbortSignal) {
      try {
        const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
        const page = await readResult(api.listRuns({ params, query: { limit: 1, runIdPrefix: run.id }, signal }));
        const index = page.items.findIndex((item) => item.id.toLowerCase() === run.id.toLowerCase());
        const value = index < 0 ? undefined : page.summaries[index];
        return value && value.attemptId.toLowerCase() === run.activeAttemptId.toLowerCase() ? value : null;
      } catch {
        return null;
      }
    }
    async function load() {
      await admission.whenIdle(controller.signal);
      if (!current) return;
      const action = admission.run(async (owned) => {
        if (!current || !owned.current) return;
        const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
        const snapshot = await readResult(
          api.compareRuns({
            params,
            body: { scope: { kind: 'workspace', ...params }, runIds: [...ids], metric: command.metric },
            signal: owned.signal,
          }),
        );
        if (!current || !owned.current) return;
        let page: RunMetricSeriesPage | undefined;
        if (command.catalogue) {
          const run = snapshot.items[0]!.run;
          page = await readResult(
            api.listRunMetricSeries({
              params: { ...params, runId: run.id, attemptId: run.activeAttemptId },
              query: { limit: 100, ...(command.cursor ? { cursor: command.cursor } : {}) },
              signal: owned.signal,
            }),
          );
        }
        let read: Map<string, RunHistorySummary | null> | undefined;
        if (command.catalogue && !command.cursor) {
          read = new Map();
          for (const item of snapshot.items) {
            if (!current || !owned.current) return;
            read.set(item.run.id.toLowerCase(), await summaryOf(item.run, owned.signal));
          }
        }
        if (!current || !owned.current) return;
        if (read) setSummaries({ owner: lease.owner, value: read });
        setSaved({ lease, view: { snapshot, ...(page ? { page } : {}), error: false, busy: false } });
      });
      if (!action) throw new Error('Comparison read busy');
      token = action.token;
      await action.original;
    }
    void load().catch(() => {
      if (current) setSaved({ lease, view: { error: true, busy: false } });
    });
    return () => {
      current = false;
      controller.abort();
      if (token) {
        admission.retire(token);
        token.controller.abort();
      }
    };
  }, [api, lease, admission]);
  function select(metric: RunMetricKey | null) {
    setChoice({ owner, command: { metric, catalogue: metric === null } });
  }
  function page(cursor?: string) {
    setChoice({ owner, command: { metric: null, catalogue: true, ...(cursor ? { cursor } : {}) } });
  }
  function retry() {
    setChoice({ owner, command: { ...command } });
  }
  const summary = summaries?.owner === owner ? summaries.value : undefined;
  return { view, summaries: summary, admission, busy: busy || view.busy, select, page, retry };
}
