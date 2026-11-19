import { EarlyArt, EarlyMeter, EarlyMetricsSkeleton } from './EarlyState.js';
import { RunResultView } from '../result/index.js';
import { useHistoryBootstrap } from '../live-history/index.js';
import type { BootstrapState } from '../live-history/index.js';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import { useMemo, useState } from 'react';
import type { Run, Suite, SuiteRevision } from '@beetle/contracts/api';
import type { RunSnapshotProps } from '../RunSnapshot.js';
import { RunReads } from '../RunReads.js';
import { EndedBanner, StallBanner } from './Banners.js';
import { WholeRun, MetricsGrid, TargetRuntime, chartDomain } from './Charts.js';
import { headlineOf, sentenceOf, statusOf, isEarlyPhase } from './copy.js';
import type { Phase } from './copy.js';
import { useSessionAccess } from '../../../app/session.js';
import { useRevision, useSuite, usePhaseReads } from './data.js';
import type { QueueRead, PhaseReads } from './data.js';
import { RestoredBanner, ScriptPicker } from './Extras.js';
import { LiveFeed } from './Feed.js';
import { clock, shortId } from './format.js';
import { provisionalSnapshot } from './provisional-download.js';
import { LiveHeader, LiveCancelButton } from './Header.js';
import type { Cancellation } from './Header.js';
import type { LiveHistory } from './history.js';
import type { LiveFigures, RuleReading } from './model.js';
import { Starting, Waiting, queueSentence } from './Phases.js';
import { readPlan, stageAt } from './plan.js';
import type { RunPlan } from './plan.js';
import { Progress } from './Progress.js';
import { Finalizing } from './Finalizing.js';
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
 * hand-off. The live download menu offers provisional snapshots.
 */
export function LiveRunView(props: LiveRunViewProps) {
  const { scope, runId, run } = props;
  const { readOnly } = useSessionAccess();
  if (readOnly) return <RunResultView {...props} />;
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
  const bootstrap = useHistoryBootstrap(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId, attemptId: run.activeAttemptId },
    stream.historyTrigger,
    stream.historyEnabled,
    stream.acceptHistory,
  );
  const phaseReads = usePhaseReads(run, stream.phase === 'starting', stream.phase === 'waiting');
  const [picker, setPicker] = useState(false);
  const at = positions(run, stream);
  return (
    <div className={`live-run${isEarlyPhase(stream.phase) ? ' is-early' : ''}`}>
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
        queue={phaseReads.queue}
        cancel={cancel}
        onScript={() => setPicker(true)}
      />
      {revision.isError && (
        <Banner
          tone="danger"
          title="Saved revision unavailable"
          actions={
            <Button
              size="sm"
              disabled={revision.isFetching}
              onClick={() => void revision.refetch({ cancelRefetch: false })}
            >
              Retry revision
            </Button>
          }
        >
          {revision.data
            ? 'Last verified revision details are kept.'
            : 'Configuration details cannot be verified. Live measurements remain bound to this attempt.'}
        </Banner>
      )}
      {picker && (
        <ScriptPicker
          run={run}
          suite={suite.isError ? undefined : suite.data}
          runRevision={revision.data}
          onClose={() => setPicker(false)}
        />
      )}
      {isEarlyPhase(stream.phase) && <EarlyArt />}
      <StateBanners run={run} plan={plan} stream={stream} showResult={showResult} />
      {stream.phase === 'finalizing' && (
        <Finalizing run={run} plan={plan} figures={stream.figures} lastT={at.stoppedAtMs} />
      )}
      <PhaseBody phase={stream.phase} run={run} revision={revision.data} cancel={cancel} reads={phaseReads} />
      {isEarlyPhase(stream.phase) && <EarlyMetricsSkeleton />}
      <LiveBoard plan={plan} stream={stream} at={at} bootstrap={bootstrap} />
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
  queue: QueueRead;
  cancel: Cancellation | undefined;
  onScript: () => void;
}) {
  const { run, plan, stream, at } = props;
  const session = useSessionAccess();
  const suiteName = props.suite?.name ?? null;
  const early = isEarlyPhase(stream.phase);
  const sentence = headerSentence(run, stream, at, plan, props.queue);
  const stage = at.elapsedMs === null ? null : stageAt(plan, at.elapsedMs);
  return (
    <LiveHeader
      early={early}
      run={run}
      suiteName={suiteName}
      revisionOrdinal={props.revision?.ordinal ?? null}
      headline={headlineOf(stream.phase, suiteName ?? `Run ${shortId(run.id)}`, stage, run)}
      sentence={sentence}
      status={{ ...statusOf(stream.phase, run), note: pauseNote(stream.paused, at.stoppedAtMs) }}
      stream={stream.streaming && stream.latest ? { paused: stream.paused, toggle: stream.togglePause } : null}
      cancel={props.cancel}
      readOnly={session.readOnly}
      snapshot={provisionalSnapshot(run.id, stream.latest, stream.history)}
      onScript={props.onScript}
    />
  );
}

function headerSentence(run: Run, stream: LiveStream, at: Positions, plan: RunPlan, queue: QueueRead) {
  if (stream.phase === 'waiting') return queueSentence(queue.isError ? undefined : queue.data);
  return sentenceOf(stream.phase, stream.readings, at.stoppedAtMs, plan, run);
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
function LiveBoard({
  plan,
  stream,
  at,
  bootstrap,
}: {
  plan: RunPlan;
  stream: LiveStream;
  at: Positions;
  bootstrap: BootstrapState;
}) {
  const { figures, phase } = stream;
  if (!figures) return null;
  const moving = phase === 'running' || phase === 'cancelling';
  return (
    <Board
      plan={plan}
      figures={figures}
      history={stream.history}
      bootstrap={bootstrap}
      historyEnabled={stream.historyEnabled}
      finalizing={phase === 'finalizing'}
      readings={stream.readings}
      elapsedMs={moving ? at.elapsedMs : at.lastT}
      origin={at.origin}
      p95Limit={ruleLimit(plan, 'http_req_duration', 'p95')}
      failedLimit={ruleLimit(plan, 'http_req_failed', 'rate')}
      stale={stream.stalled || stream.paused || phase !== 'running'}
    />
  );
}

function PhaseBody({
  phase,
  run,
  revision,
  cancel,
  reads,
}: {
  phase: Phase;
  reads: PhaseReads;
  run: Run;
  revision: SuiteRevision | undefined;
  cancel: Cancellation | undefined;
}) {
  const session = useSessionAccess();
  if (phase !== 'waiting' && phase !== 'starting') return null;
  return (
    <div className="live-early-body">
      <EarlyMeter />
      {phase === 'waiting' ? (
        <Waiting run={run} revision={revision} query={reads.queue} />
      ) : (
        <Starting run={run} revision={revision} engineVersion={reads.engineVersion} />
      )}
      <div className="live-early-actions">
        <LiveCancelButton run={run} cancel={cancel} readOnly={session.readOnly} early />
      </div>
    </div>
  );
}

function Board(props: {
  plan: RunPlan;
  finalizing: boolean;
  figures: LiveFigures;
  history: LiveHistory;
  bootstrap: BootstrapState;
  historyEnabled: boolean;
  readings: RuleReading[];
  elapsedMs: number | null;
  origin: number | null;
  p95Limit: number | null;
  failedLimit: number | null;
  stale: boolean;
}) {
  const domain = chartDomain(props.history, props.plan);
  const [hoverT, onHover] = useState<number | null>(null);
  const hover = { hoverT, onHover };
  return (
    <div className={`live-board${props.stale ? ' is-stale' : ''}`}>
      {!props.finalizing && (
        <Progress
          plan={props.plan}
          elapsedMs={props.elapsedMs}
          originMs={props.origin}
          figures={props.figures}
          p95Limit={props.p95Limit}
          failedLimit={props.failedLimit}
        />
      )}
      <WholeRun
        history={props.history}
        hover={hover}
        bootstrap={props.bootstrap}
        historyEnabled={props.historyEnabled}
        plan={props.plan}
        domain={domain}
        p95Limit={props.p95Limit}
        slowest={props.figures.p95?.slowest ?? false}
      />
      <div className="live-split">
        <Thresholds readings={props.readings} />
        <Endpoints figures={props.figures} />
      </div>
      <MetricsGrid history={props.history} domain={domain} hover={hover} />
      <TargetRuntime
        history={props.history}
        domain={domain}
        origin={props.plan.targetOrigin}
        hover={hover}
        units={props.plan.targetUnits}
      />
    </div>
  );
}
