import { useMemo, useState } from 'react';
import type { Run, Suite, SuiteRevision } from '@beetle/contracts/api';
import type { RunSnapshotProps } from '../RunSnapshot.js';
import { RunReads } from '../RunReads.js';
import { EndedBanner, StallBanner } from './Banners.js';
import { WholeRun, MetricsGrid, TargetRuntime, chartDomain } from './Charts.js';
import { headlineOf, sentenceOf, statusOf } from './copy.js';
import type { Phase } from './copy.js';
import { useRestoredBackup, useRevision, useSuite } from './data.js';
import { RestoredBanner, ScriptPicker } from './Extras.js';
import { LiveFeed } from './Feed.js';
import { clock, shortId } from './format.js';
import { LiveHeader } from './Header.js';
import type { Cancellation } from './Header.js';
import type { LiveHistory } from './history.js';
import type { LiveFigures, RuleReading } from './model.js';
import { Finalizing, Starting, Waiting } from './Phases.js';
import { readPlan, stageAt } from './plan.js';
import type { RunPlan } from './plan.js';
import { Progress } from './Progress.js';
import { positions, useLiveStream } from './stream.js';
import type { LiveStream } from './stream.js';
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

function pauseNote(paused: boolean, stoppedAtMs: number | null): string | undefined {
  if (!paused) return undefined;
  return stoppedAtMs === null ? 'stream paused' : `stream paused at ${clock(stoppedAtMs)}`;
}

const ruleLimit = (plan: RunPlan, metric: string, stat: string) =>
  plan.rules.find((r) => r.metric === metric && r.stat === stat)?.value ?? null;

type Positions = ReturnType<typeof positions>;

function LiveRun({ run, scope, runId, showResult, cancel }: LiveRunViewProps) {
  const revision = useRevision(run);
  const suite = useSuite(run);
  const plan = useMemo(() => readPlan(revision.data?.config), [revision.data]);
  const stream = useLiveStream(run, cancel?.accepted === true, plan, !revision.isPending);
  const [picker, setPicker] = useState(false);
  const at = positions(run, stream);
  return (
    <div className="live-run">
      <RestoredBanner />
      <LiveFeed
        key={stream.feedKey}
        run={run}
        scope={scope}
        runId={runId}
        enabled={stream.feedEnabled}
        onState={stream.onState}
      />
      <RunHeader
        run={run}
        plan={plan}
        stream={stream}
        at={at}
        revision={revision.data}
        suite={suite.data}
        cancel={cancel}
        onScript={() => setPicker(true)}
      />
      {picker && <ScriptPicker run={run} suite={suite.data} onClose={() => setPicker(false)} />}
      <StateBanners run={run} plan={plan} stream={stream} showResult={showResult} />
      <PhaseBody phase={stream.phase} run={run} />
      <LiveBoard plan={plan} stream={stream} at={at} />
    </div>
  );
}

function RunHeader(props: {
  run: Run;
  plan: RunPlan;
  stream: LiveStream;
  at: Positions;
  revision: SuiteRevision | undefined;
  suite: Suite | undefined;
  cancel: Cancellation | undefined;
  onScript: () => void;
}) {
  const { run, plan, stream, at } = props;
  const session = useRestoredBackup();
  const suiteName = props.suite?.name ?? null;
  const stage = at.elapsedMs === null ? null : stageAt(plan, at.elapsedMs);
  return (
    <LiveHeader
      run={run}
      suiteName={suiteName}
      revisionOrdinal={props.revision?.ordinal ?? null}
      headline={headlineOf(stream.phase, suiteName ?? `Run ${shortId(run.id)}`, stage, run)}
      sentence={sentenceOf(stream.phase, stream.readings, at.stoppedAtMs, plan, run)}
      status={{ ...statusOf(stream.phase, run), note: pauseNote(stream.paused, at.stoppedAtMs) }}
      stream={stream.streaming && stream.latest ? { paused: stream.paused, toggle: stream.togglePause } : null}
      cancel={props.cancel}
      readOnly={session.data?.readOnly === true}
      onScript={props.onScript}
    />
  );
}

function StateBanners({
  run,
  plan,
  stream,
  showResult,
}: {
  run: Run;
  plan: RunPlan;
  stream: LiveStream;
  showResult: () => void;
}) {
  const { latest } = stream;
  if (stream.stalled && latest)
    return <StallBanner silentMs={stream.now - latest.receivedWall} onRetry={stream.retry} />;
  if (stream.phase === 'ended') return <EndedBanner run={run} requests={plan.requests} showResult={showResult} />;
  return null;
}

/** The figures board, once a frame has arrived; dimmed whenever it is not the current running window. */
function LiveBoard({ plan, stream, at }: { plan: RunPlan; stream: LiveStream; at: Positions }) {
  const { figures, phase } = stream;
  if (!figures) return null;
  const moving = phase === 'running' || phase === 'cancelling';
  return (
    <Board
      plan={plan}
      figures={figures}
      history={stream.history}
      readings={stream.readings}
      elapsedMs={moving ? at.elapsedMs : at.lastT}
      origin={at.origin}
      p95Limit={ruleLimit(plan, 'http_req_duration', 'p95')}
      failedLimit={ruleLimit(plan, 'http_req_failed', 'rate')}
      stale={stream.stalled || stream.paused || phase !== 'running'}
    />
  );
}

function PhaseBody({ phase, run }: { phase: Phase; run: Run }) {
  if (phase === 'waiting') return <Waiting run={run} />;
  if (phase === 'starting') return <Starting run={run} />;
  if (phase === 'finalizing') return <Finalizing run={run} />;
  return null;
}

function Board(props: {
  plan: RunPlan;
  figures: LiveFigures;
  history: LiveHistory;
  readings: RuleReading[];
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
