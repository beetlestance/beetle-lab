import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveMetricSnapshot, Run } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import type { RunSnapshotProps } from '../RunSnapshot.js';
import { RunReads } from '../RunReads.js';
import { WholeRun, MetricsGrid, TargetRuntime, chartDomain } from './Charts.js';
import { phaseOf, headlineOf, statusOf, thresholdSentence } from './copy.js';
import type { Phase } from './copy.js';
import { useRestoredBackup, useRevision, useSuite } from './data.js';
import { LatencyRise, RestoredBanner, ScriptPicker } from './Extras.js';
import { LiveFeed } from './Feed.js';
import type { FeedState } from './Feed.js';
import { clock, shortId } from './format.js';
import { LiveHeader } from './Header.js';
import type { Cancellation } from './Header.js';
import { appendFrame, emptyHistory } from './history.js';
import type { LiveHistory } from './history.js';
import { liveFigures, readRule } from './model.js';
import type { LiveFigures } from './model.js';
import { Finalizing, Starting, Waiting } from './Phases.js';
import { readPlan, stageAt } from './plan.js';
import type { RunPlan } from './plan.js';
import { Progress } from './Progress.js';
import { Endpoints, Thresholds } from './Tables.js';
import './live.css';

export type LiveRunViewProps = RunSnapshotProps & {
  /** Hands off to the result view (remounts and re-reads). Call only for a terminal run. */
  showResult: () => void;
  /**
   * RunDetail's cancellation owner. When given, Cancel run lives in this header;
   * when omitted, RunDetail's own cancellation section stays the only control.
   */
  cancel?: Cancellation | undefined;
};

/**
 * Live run view (Penpot "Live run" boards) for a nonterminal run: waiting,
 * starting, running, paused, reconnecting, cancelling and finalizing. A run that
 * ends while watched keeps its last live figures here with an "Open result"
 * hand-off. No report or metrics downloads are offered while live.
 */
export function LiveRunView(props: LiveRunViewProps) {
  const { scope, runId, run } = props;
  return (
    <RunReads key={`${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}>
      <LiveRun {...props} />
    </RunReads>
  );
}

interface Latest {
  frame: LiveMetricSnapshot;
  receivedWall: number;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function LiveRun({ run, scope, runId, showResult, cancel }: LiveRunViewProps) {
  const revision = useRevision(run);
  const suite = useSuite(run);
  const session = useRestoredBackup();
  const plan = useMemo(() => readPlan(revision.data?.config), [revision.data]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const [paused, setPaused] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const [feed, setFeed] = useState<FeedState['status']>('loading');
  const [latest, setLatest] = useState<Latest | null>(null);
  const [history, setHistory] = useState<LiveHistory>(() => emptyHistory(run.startedAt));
  const [picker, setPicker] = useState(false);
  const phase = phaseOf(run, cancel?.accepted === true, latest !== null);
  const streaming = run.state === 'active' && !run.cancellationRequested && cancel?.accepted !== true;
  const now = useNow(!['ended', 'finalizing'].includes(phase));

  const onState = useCallback((state: FeedState) => {
    setFeed(state.status);
    if (state.status !== 'ready') return;
    const { frame, receivedWall } = state.value;
    setLatest((old) => (old && old.receivedWall === receivedWall ? old : { frame, receivedWall }));
    setHistory((old) => appendFrame(old, frame, liveFigures(frame, planRef.current)));
  }, []);

  const suiteName = suite.data?.name ?? null;
  // Recomputed from the frame so a plan that loads later still names the endpoints.
  const figures = useMemo(() => (latest ? liveFigures(latest.frame, plan) : null), [latest, plan]);
  const readings = figures ? plan.rules.map((rule) => readRule(rule, figures)) : [];
  const origin = Number.isFinite(history.originMs) ? history.originMs : null;
  const elapsedMs = run.startedAt ? Math.max(0, now - Date.parse(run.startedAt)) : null;
  const lastT = history.points.at(-1)?.t ?? null;
  const stoppedAt = lastT !== null && history.fromStart ? clock(lastT) : null;
  const p95Rule = plan.rules.find((r) => r.metric === 'http_req_duration' && r.stat === 'p95');
  const failedRule = plan.rules.find((r) => r.metric === 'http_req_failed' && r.stat === 'rate');
  const stalled = streaming && !paused && latest !== null && (feed === 'unavailable' || feed === 'stale');

  const sentence = sentenceOf(phase, readings, stoppedAt, plan, run);
  const status = statusOf(phase, run);
  const note = paused && stoppedAt ? `stream paused at ${stoppedAt}` : paused ? 'stream paused' : undefined;
  return (
    <div className="live-run">
      <RestoredBanner />
      <LiveFeed
        key={feedKey}
        run={run}
        scope={scope}
        runId={runId}
        enabled={streaming && !paused && !revision.isPending}
        onState={onState}
      />
      <LiveHeader
        run={run}
        suiteName={suiteName}
        revisionOrdinal={revision.data?.ordinal ?? null}
        headline={headlineOf(
          phase,
          suiteName ?? `Run ${shortId(run.id)}`,
          elapsedMs === null ? null : stageAt(plan, elapsedMs),
          run,
        )}
        sentence={sentence}
        status={{ ...status, note }}
        stream={streaming && latest ? { paused, toggle: () => setPaused((p) => !p) } : null}
        cancel={cancel}
        readOnly={session.data?.readOnly === true}
        onScript={() => setPicker(true)}
      />
      {picker && <ScriptPicker run={run} suite={suite.data} onClose={() => setPicker(false)} />}
      {stalled && (
        <Banner
          tone="warning"
          title={`No word for ${Math.max(0, Math.round((now - latest.receivedWall) / 1000))} s`}
          actions={
            <Button size="sm" onClick={() => setFeedKey((k) => k + 1)}>
              Retry now
            </Button>
          }
        >
          Reconnecting to the live feed. The figures below are from the last window received.
        </Banner>
      )}
      {phase === 'ended' && (
        <Banner
          tone={run.state === 'errored' ? 'danger' : 'info'}
          title={`Run ${run.state}`}
          actions={
            <Button variant="primary" onClick={showResult}>
              Open result
            </Button>
          }
        >
          The result is sealed and ready to read. The figures below are the last live window this page received.
          <LatencyRise run={run} requests={plan.requests} />
        </Banner>
      )}
      <PhaseBody phase={phase} run={run} />
      {figures && (
        <Board
          plan={plan}
          figures={figures}
          history={history}
          readings={readings}
          elapsedMs={phase === 'running' || phase === 'cancelling' ? elapsedMs : lastT}
          origin={origin}
          p95Limit={p95Rule?.value ?? null}
          failedLimit={failedRule?.value ?? null}
          stale={stalled || paused || phase !== 'running'}
        />
      )}
    </div>
  );
}

function PhaseBody({ phase, run }: { phase: Phase; run: Run }) {
  if (phase === 'waiting') return <Waiting run={run} />;
  if (phase === 'starting') return <Starting run={run} />;
  if (phase === 'finalizing') return <Finalizing run={run} />;
  return null;
}

function sentenceOf(
  phase: Phase,
  readings: ReturnType<typeof readRule>[],
  stoppedAt: string | null,
  plan: RunPlan,
  run: Run,
): string {
  const total = plan.totalMs === null ? '' : ` of ${clock(plan.totalMs)}`;
  switch (phase) {
    case 'waiting':
      return 'The run starts as soon as a slot frees up.';
    case 'starting':
      return 'Preparing the load generator. Live figures appear with the first metrics window.';
    case 'running':
      return thresholdSentence(readings);
    case 'cancelling':
      return `${stoppedAt ? `Stopped sending at ${stoppedAt}${total}. ` : ''}Waiting for in-flight requests to finish before the results are sealed.`;
    case 'finalizing':
      return `${stoppedAt ? `Run stopped at ${stoppedAt}${total}. ` : ''}Sealing results${run.cancellationRequested ? ' after the cancel' : ''}; the verdict appears when sealing finishes.`;
    case 'ended':
      return run.outcome === 'pending' ? 'The outcome is still pending.' : `Outcome: ${run.outcome}.`;
  }
}

function Board(props: {
  plan: RunPlan;
  figures: LiveFigures;
  history: LiveHistory;
  readings: ReturnType<typeof readRule>[];
  elapsedMs: number | null;
  origin: number | null;
  p95Limit: number | null;
  failedLimit: number | null;
  stale: boolean;
}) {
  const domain = chartDomain(props.history, props.plan);
  return (
    <div className={`live-board${props.stale ? ' is-stale' : ''}`}>
      <Progress
        plan={props.plan}
        elapsedMs={props.elapsedMs}
        originMs={props.origin}
        figures={props.figures}
        p95Limit={props.p95Limit}
        failedLimit={props.failedLimit}
      />
      <WholeRun
        history={props.history}
        plan={props.plan}
        domain={domain}
        p95Limit={props.p95Limit}
        slowest={props.figures.p95?.slowest ?? false}
      />
      <div className="live-split">
        <Thresholds readings={props.readings} />
        <Endpoints figures={props.figures} />
      </div>
      <MetricsGrid history={props.history} domain={domain} />
      <TargetRuntime history={props.history} domain={domain} origin={props.plan.targetOrigin} />
    </div>
  );
}
