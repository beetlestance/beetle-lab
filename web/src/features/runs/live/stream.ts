import { historyMatches, mergeHistory } from './backfill.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveMetricSnapshot, LiveMetricHistory, Run } from '@beetle/contracts/api';
import { phaseOf } from './copy.js';
import type { Phase } from './copy.js';
import type { FeedState } from './Feed.js';
import { appendFrame, emptyHistory } from './history.js';
import type { LiveHistory } from './history.js';
import { liveFigures, readRule } from './model.js';
import type { LiveFigures, RuleReading } from './model.js';
import type { RunPlan } from './plan.js';

export interface Latest {
  readonly frame: LiveMetricSnapshot;
  readonly receivedWall: number;
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

export interface LiveStream {
  readonly historyEnabled: boolean;
  readonly historyTrigger: object | null;
  readonly acceptHistory: (value: LiveMetricHistory) => void;
  readonly phase: Phase;
  /** True while the run executes and no cancel is under way: the feed may read. */
  readonly streaming: boolean;
  /** Streaming, not paused, and the revision read has settled (so figures name endpoints). */
  readonly feedEnabled: boolean;
  readonly paused: boolean;
  readonly togglePause: () => void;
  /** Remount key for the feed; bumping it is "Retry now". */
  readonly feedKey: number;
  readonly retry: () => void;
  readonly onState: (state: FeedState) => void;
  readonly latest: Latest | null;
  readonly history: LiveHistory;
  /** Figures from the latest frame, recomputed so a plan that loads later still names endpoints. */
  readonly figures: LiveFigures | null;
  readonly readings: RuleReading[];
  /** Streaming, not paused, a frame shown, and the feed is unavailable or stale. */
  readonly stalled: boolean;
  readonly now: number;
}

/** The feed has gone quiet: no current frame (unavailable) or the last one expired (stale). */
const quiet = (feed: FeedState['status']) => feed === 'unavailable' || feed === 'stale';

const canStream = (run: Run, cancelAccepted: boolean) =>
  run.state === 'active' && !run.cancellationRequested && !cancelAccepted;

/** Live view state: feed status, latest frame, bounded history, pause and retry. */
export function useLiveStream(run: Run, cancelAccepted: boolean, plan: RunPlan, planReady: boolean): LiveStream {
  const planRef = useRef(plan);
  const runRef = useRef(run);
  runRef.current = run;
  const latestRef = useRef<Latest | null>(null);
  const previousFeed = useRef<{ status: FeedState['status']; owner: object } | null>(null);
  const [historyTrigger, setHistoryTrigger] = useState<object | null>(null);
  planRef.current = plan;
  const [paused, setPaused] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const [feed, setFeed] = useState<FeedState['status']>('loading');
  const [latest, setLatest] = useState<Latest | null>(null);
  const [history, setHistory] = useState<LiveHistory>(() => emptyHistory(run.startedAt));
  const phase = phaseOf(run, cancelAccepted, latest !== null);
  const streaming = canStream(run, cancelAccepted);
  const now = useNow(phase !== 'ended' && phase !== 'finalizing');

  const onState = useCallback((state: FeedState) => {
    const previous = previousFeed.current;
    previousFeed.current = { status: state.status, owner: state.owner };
    setFeed(state.status);
    if (state.status !== 'ready') return;
    const { frame, receivedWall } = state.value;
    const prior = latestRef.current;
    const changed =
      prior && (prior.frame.producerEpoch !== frame.producerEpoch || prior.frame.subsetDigest !== frame.subsetDigest);
    const next = { frame, receivedWall };
    latestRef.current = next;
    setLatest(next);
    if (changed || previous?.status !== 'ready' || previous.owner !== state.owner) setHistoryTrigger({});
    setHistory((old) =>
      appendFrame(changed ? emptyHistory(runRef.current.startedAt) : old, frame, liveFigures(frame, planRef.current)),
    );
  }, []);
  const acceptHistory = useCallback((value: LiveMetricHistory) => {
    const frame = latestRef.current?.frame;
    if (!frame || !historyMatches(value, frame)) throw Error('Recorded history unavailable');
    setHistory((old) =>
      latestRef.current && historyMatches(value, latestRef.current.frame)
        ? mergeHistory(old, value, planRef.current, runRef.current.startedAt)
        : old,
    );
  }, []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const retry = useCallback(() => setFeedKey((k) => k + 1), []);

  const figures = useMemo(() => (latest ? liveFigures(latest.frame, plan) : null), [latest, plan]);
  const readings = figures ? plan.rules.map((rule) => readRule(rule, figures)) : [];
  const stalled = streaming && !paused && latest !== null && quiet(feed);
  const feedEnabled = streaming && !paused && planReady;
  return {
    historyEnabled: feedEnabled && feed !== 'paused',
    historyTrigger,
    acceptHistory,
    phase,
    streaming,
    feedEnabled,
    paused,
    togglePause,
    feedKey,
    retry,
    onState,
    latest,
    history,
    figures,
    readings,
    stalled,
    now,
  };
}

/** Clock positions the view reads: elapsed since start, last received window, and where it stopped. */
export function positions(run: Run, stream: Pick<LiveStream, 'history' | 'now'>) {
  const { history, now } = stream;
  const start = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const elapsed = now - start;
  const elapsedMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  const lastT = history.points.at(-1)?.t ?? null;
  return {
    elapsedMs,
    lastT,
    stoppedAtMs: lastT !== null && history.fromStart ? lastT : null,
    origin: Number.isFinite(history.originMs) ? history.originMs : null,
  };
}
