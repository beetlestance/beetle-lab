import { useEffect, useMemo, useState } from 'react';
import type {
  RunComparisonSnapshot,
  RunHistorySummary,
  RunMetricOverview,
  RunChartHistory,
  RunListContext,
  RunMetricKey,
  RunMetricSeriesPage,
} from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { ReadAdmission } from '../metrics/index.js';
import type { RunScope } from '../types.js';
import { readComparisonTarget } from './target-read.js';
import type { ComparisonTargets, ComparisonTargetRead } from './target-read.js';
interface Command {
  metric: RunMetricKey | null;
  catalogue: boolean;
  refreshFacts?: boolean;
  cursor?: string;
}
interface View {
  snapshot?: RunComparisonSnapshot;
  page?: RunMetricSeriesPage;
  error: boolean;
  catalogueError: boolean;
  busy: boolean;
}
export type OverviewRead =
  { readonly status: 'error' } | { readonly status: 'loaded'; readonly value: RunMetricOverview };
export type ChartRead = { readonly status: 'error' } | { readonly status: 'loaded'; readonly value: RunChartHistory };
export type ComparisonHistories = ReadonlyMap<string, ChartRead>;
export type Overviews = ReadonlyMap<string, OverviewRead>;
export type ComparisonContexts = ReadonlyMap<string, RunListContext | null>;
export type Summaries = ReadonlyMap<string, RunHistorySummary | null>;
interface CapturedReads {
  summaries: Summaries;
  overviews: Overviews;
  contexts: ComparisonContexts;
  histories: ComparisonHistories;
  workspaceName: string | null;
  targets: ComparisonTargets;
}
interface SavedReads {
  owner: object;
  value: CapturedReads;
}
function ownedReads(saved: SavedReads | undefined, owner: object): CapturedReads | undefined {
  return saved?.owner === owner ? saved.value : undefined;
}
// Physical admission outlives routes and sessions; it retains no result cache.
const comparisonAdmission = new ReadAdmission();
const initial: Command = { metric: null, catalogue: true };
const empty: View = { error: false, catalogueError: false, busy: true };
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
  if (ids.length === 0) return workspaceOnly(context);
  const snapshot = await readResult(
    api.compareRuns({
      params,
      body: { scope: { kind: 'workspace', ...params }, runIds: [...ids], metric: command.metric },
      signal,
    }),
  );
  if (!alive()) return undefined;
  const catalogue = command.catalogue
    ? await captureCatalogue(context, snapshot, command.cursor)
    : { page: undefined, catalogueError: false };
  const firstLoad = command.refreshFacts === true || (command.catalogue && !command.cursor);
  const read = firstLoad ? await readSummaries(context, snapshot) : undefined;
  return { snapshot, ...catalogue, read };
}

/** Catalogue capacity failures do not erase an already accepted comparison. */
async function captureCatalogue(context: ReadContext, snapshot: RunComparisonSnapshot, cursor?: string) {
  try {
    return { page: await readCatalogue(context, snapshot, cursor), catalogueError: false };
  } catch {
    return { page: undefined, catalogueError: true };
  }
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
  let workspaceName: string | null = null;
  const overviews = new Map<string, OverviewRead>();
  const contexts = new Map<string, RunListContext | null>();
  const histories = new Map<string, ChartRead>();
  const targets = new Map<string, ComparisonTargetRead>();
  for (const item of snapshot.items) {
    if (!context.alive()) break;
    const record = await summaryOf(context, item.run);
    if (read.size === 0) workspaceName = record.workspaceName;
    read.set(item.run.id.toLowerCase(), record.summary);
    contexts.set(item.run.id.toLowerCase(), record.context);
    if (!context.alive()) break;
    overviews.set(item.run.id.toLowerCase(), await overviewOf(context, item.run));
    if (!context.alive()) break;
    histories.set(item.run.id.toLowerCase(), await chartOf(context, item.run));
    if (!context.alive()) break;
    targets.set(item.run.id.toLowerCase(), await readComparisonTarget(context, item));
  }
  return { summaries: read, overviews, contexts, histories, targets, workspaceName };
}

/** One run's stored history summary (one exact-ID row); a failure is only a gap. */
async function summaryOf({ api, params, signal }: ReadContext, run: ComparedRun) {
  try {
    const page = await readResult(api.listRuns({ params, query: { limit: 1, runIdPrefix: run.id }, signal }));
    const index = page.items.findIndex((item) => item.id.toLowerCase() === run.id.toLowerCase());
    const value = index < 0 ? undefined : page.summaries[index];
    const summary = value && value.attemptId.toLowerCase() === run.activeAttemptId.toLowerCase() ? value : null;
    const metadata = page.contexts?.[index];
    return { summary, context: boundContext(metadata, run), workspaceName: page.workspaceName ?? null };
  } catch {
    return { summary: null, context: null, workspaceName: null };
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

/** The server verifies the whole archive and returns at most 900 actual source windows. */
async function chartOf({ api, params, signal }: ReadContext, run: ComparedRun): Promise<ChartRead> {
  try {
    const value = await readResult(
      api.getRunChartHistory({ params: { ...params, runId: run.id, attemptId: run.activeAttemptId }, signal }),
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
  // Whole-run and recorded evidence share the first catalogue load and selection owner.
  const [captured, setCaptured] = useState<SavedReads>();
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
        if (result.read) setCaptured({ owner: lease.owner, value: result.read });
        const { snapshot, page, catalogueError } = result;
        setSaved({
          lease,
          view: {
            ...(snapshot ? { snapshot } : {}),
            ...(page ? { page } : {}),
            catalogueError,
            error: false,
            busy: false,
          },
        });
      });
      if (!action) throw new Error('Comparison read busy');
      token = action.token;
      await action.original;
    }
    void load().catch(() => {
      if (current) {
        setCaptured((saved) =>
          saved?.owner === lease.owner
            ? { ...saved, value: { ...saved.value, contexts: new Map(), workspaceName: null } }
            : saved,
        );
        setSaved({ lease, view: { error: true, catalogueError: false, busy: false } });
      }
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
    setChoice({ owner, command: { ...command, refreshFacts: true } });
  }
  const recorded = ownedReads(captured, owner);
  return { view, ...presentReads(recorded, view.error), admission, busy: busy || view.busy, select, page, retry };
}

/** Empty selection still resolves its real workspace, without comparison or metric reads. */
async function workspaceOnly({ api, params, signal, alive }: ReadContext) {
  const page = await readResult(api.listRuns({ params, query: { limit: 1 }, signal }));
  if (!alive()) return undefined;
  const read: CapturedReads = {
    workspaceName: page.workspaceName ?? null,
    summaries: new Map(),
    overviews: new Map(),
    contexts: new Map(),
    histories: new Map(),
    targets: new Map(),
  };
  return { snapshot: undefined, page: undefined, catalogueError: false, read };
}

/** Failed reads retire mutable names while preserving immutable captured evidence. */
function presentReads(recorded: CapturedReads | undefined, failed: boolean) {
  return {
    summaries: recorded?.summaries,
    overviews: recorded?.overviews,
    contexts: failed ? undefined : recorded?.contexts,
    workspaceName: failed ? null : (recorded?.workspaceName ?? null),
    histories: recorded?.histories,
    targets: recorded?.targets,
  };
}
