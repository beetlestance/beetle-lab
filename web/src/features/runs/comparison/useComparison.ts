import { useEffect, useMemo, useState } from 'react';
import type {
  RunComparisonSnapshot,
  RunHistorySummary,
  RunMetricOverview,
  RunListContext,
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
export type OverviewRead =
  { readonly status: 'error' } | { readonly status: 'loaded'; readonly value: RunMetricOverview };
export type Overviews = ReadonlyMap<string, OverviewRead>;
export type ComparisonContexts = ReadonlyMap<string, RunListContext | null>;
export type Summaries = ReadonlyMap<string, RunHistorySummary | null>;
// Physical admission outlives routes and sessions; it retains no result cache.
const comparisonAdmission = new ReadAdmission();
const initial: Command = { metric: null, catalogue: true };
const empty: View = { error: false, busy: true };
type ComparedRun = RunComparisonSnapshot['items'][number]['run'];
/** One admitted read: its client, scope, abort signal, and whether its result is still wanted. */
interface ReadContext {
  api: ReturnType<typeof useApi>;
  params: { organizationId: string; workspaceId: string };
  signal: AbortSignal;
  alive: () => boolean;
}

/** Reads one comparison in order: snapshot, then catalogue, then first-load summaries. */
async function readComparison(context: ReadContext, ids: readonly string[], command: Command) {
  const { api, params, signal, alive } = context;
  if (!alive()) return undefined;
  const snapshot = await readResult(
    api.compareRuns({
      params,
      body: { scope: { kind: 'workspace', ...params }, runIds: [...ids], metric: command.metric },
      signal,
    }),
  );
  if (!alive()) return undefined;
  const page = command.catalogue ? await readCatalogue(context, snapshot, command.cursor) : undefined;
  const firstLoad = command.catalogue && !command.cursor;
  const read = firstLoad ? await readSummaries(context, snapshot) : undefined;
  return { snapshot, page, read };
}

function readCatalogue({ api, params, signal }: ReadContext, snapshot: RunComparisonSnapshot, cursor?: string) {
  const run = snapshot.items[0]!.run;
  return readResult(
    api.listRunMetricSeries({
      params: { ...params, runId: run.id, attemptId: run.activeAttemptId },
      query: { limit: 100, ...(cursor ? { cursor } : {}) },
      signal,
    }),
  );
}

/** Sequential; stops as soon as the read is no longer wanted, and the caller then discards it. */
async function readSummaries(context: ReadContext, snapshot: RunComparisonSnapshot) {
  const read = new Map<string, RunHistorySummary | null>();
  const overviews = new Map<string, OverviewRead>();
  const contexts = new Map<string, RunListContext | null>();
  for (const item of snapshot.items) {
    if (!context.alive()) break;
    const record = await summaryOf(context, item.run);
    read.set(item.run.id.toLowerCase(), record.summary);
    contexts.set(item.run.id.toLowerCase(), record.context);
    if (!context.alive()) break;
    overviews.set(item.run.id.toLowerCase(), await overviewOf(context, item.run));
  }
  return { summaries: read, overviews, contexts };
}

/** One run's stored history summary (one exact-ID row); a failure is only a gap. */
async function summaryOf({ api, params, signal }: ReadContext, run: ComparedRun) {
  try {
    const page = await readResult(api.listRuns({ params, query: { limit: 1, runIdPrefix: run.id }, signal }));
    const index = page.items.findIndex((item) => item.id.toLowerCase() === run.id.toLowerCase());
    const value = index < 0 ? undefined : page.summaries[index];
    const summary = value && value.attemptId.toLowerCase() === run.activeAttemptId.toLowerCase() ? value : null;
    const metadata = page.contexts?.[index];
    return { summary, context: boundContext(metadata, run) };
  } catch {
    return { summary: null, context: null };
  }
}

function boundContext(value: RunListContext | undefined, run: ComparedRun): RunListContext | null {
  return value &&
    value.runId.toLowerCase() === run.id.toLowerCase() &&
    value.suiteId.toLowerCase() === run.suiteId.toLowerCase() &&
    value.revisionId.toLowerCase() === run.revisionId.toLowerCase()
    ? value
    : null;
}

/** A bounded projection per run, sequenced within the same original admission. */
async function overviewOf({ api, params, signal }: ReadContext, run: ComparedRun): Promise<OverviewRead> {
  try {
    const value = await readResult(
      api.getRunMetricOverview({ params: { ...params, runId: run.id, attemptId: run.activeAttemptId }, signal }),
    );
    return { status: 'loaded', value };
  } catch {
    return { status: 'error' };
  }
}

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
  const [summaries, setSummaries] = useState<{
    owner: object;
    value: { summaries: Summaries; overviews: Overviews; contexts: ComparisonContexts };
  }>();
  useEffect(() => admission.subscribe(() => setBusy(admission.busy)), [admission]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    let token: Parameters<ReadAdmission['retire']>[0] | undefined;
    async function load() {
      await admission.whenIdle(controller.signal);
      if (!current) return;
      const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
      const action = admission.run(async (owned) => {
        const alive = () => current && owned.current;
        const result = await readComparison({ api, params, signal: owned.signal, alive }, ids, command);
        if (!result || !alive()) return;
        if (result.read) setSummaries({ owner: lease.owner, value: result.read });
        const { snapshot, page } = result;
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
  const recorded = summaries?.owner === owner ? summaries.value : undefined;
  return {
    view,
    summaries: recorded?.summaries,
    overviews: recorded?.overviews,
    contexts: recorded?.contexts,
    admission,
    busy: busy || view.busy,
    select,
    page,
    retry,
  };
}
