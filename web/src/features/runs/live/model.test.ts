import { expect, it } from 'vitest';
import { durationMs, readPlan, stageAt } from './plan.js';
import { liveFigures, readRule } from './model.js';
import { headlineOf, phaseOf, thresholdSentence } from './copy.js';
import { appendFrame, emptyHistory, HISTORY_LIMIT } from './history.js';
import { clock, ms, percent } from './format.js';
import { config, liveFrame, liveRun, startedAt } from './fixtures.js';

it('reads stages, drain, requests and thresholds from the saved config', () => {
  const plan = readPlan(config);
  expect(plan.stages.map((s) => [s.label, s.startMs, s.durationMs, s.drain])).toEqual([
    ['Ramp to 1,200 a second', 0, 60_000, false],
    ['Steady at 1,200 a second', 60_000, 480_000, false],
    ['Drain', 540_000, 60_000, true],
  ]);
  expect(plan.totalMs).toBe(600_000);
  expect(plan.maxVus).toBe(300);
  expect(plan.requests.map((r) => r.label)).toEqual(['r0', 'r1']);
  expect(plan.rules).toHaveLength(3);
  expect(plan.targetOrigin).toBe('checkout-api:8080');
  expect(stageAt(plan, 316_000)?.label).toBe('Steady at 1,200 a second');
  expect(durationMs('1500ms')).toBe(1500);
  expect(durationMs('1d')).toBeNull();
});

it('hides timing it cannot read instead of guessing a length', () => {
  expect(readPlan({}).totalMs).toBeNull();
  expect(readPlan(null).stages).toEqual([]);
  const iterations = { loadPlan: { version: 1, slos: [], scenarios: [{ executor: 'shared-iterations', vus: 5 }] } };
  expect(readPlan(iterations)).toMatchObject({ totalMs: null, stages: [], maxVus: 5 });
  const multi = {
    loadPlan: {
      version: 1,
      slos: [],
      scenarios: [
        { executor: 'constant-vus', vus: 2, duration: '1m', startTime: '0s', gracefulStop: '10s' },
        { executor: 'constant-vus', vus: 3, duration: '2m', startTime: '30s', gracefulStop: '0s' },
      ],
    },
  };
  expect(readPlan(multi)).toMatchObject({ totalMs: 150_000, stages: [], maxVus: 5 });
});

it('derives window rates, pooled failure and slowest-endpoint percentiles without averaging', () => {
  const plan = readPlan(config);
  const { frame } = liveFrame(liveRun());
  const figures = liveFigures(frame, plan);
  expect(figures.rps).toBe(1200);
  expect(figures.p95).toEqual({ value: 236, slowest: true, fastest: 12 });
  expect(figures.failedRatio).toBeCloseTo(2 / 1200);
  expect(figures.failedPerSecond).toBe(2);
  expect(figures.vus).toBe(142);
  expect(figures.vusMax).toBe(300);
  expect(figures.endpoints.map((e) => [e.request?.path, e.share])).toEqual([
    ['/checkout', 0.75],
    ['/health', 0.25],
  ]);
  const holding = readRule(plan.rules[0]!, figures);
  expect(holding).toMatchObject({ state: 'holding', value: 236, bound: 'at-most' });
  // Slowest over, fastest under: the pooled p95 could be either side.
  expect(readRule({ ...plan.rules[0]!, value: 100 }, figures).state).toBe('unknown');
  expect(readRule({ ...plan.rules[0]!, value: 10 }, figures).state).toBe('over');
  expect(readRule(plan.rules[1]!, figures).state).toBe('holding');
  expect(readRule(plan.rules[2]!, figures)).toMatchObject({ state: 'unknown', value: null });
});

it('leaves totals unknown when a planned endpoint is outside the live subset', () => {
  const plan = readPlan({ ...config, requests: [...config.requests, { ...config.requests[0], name: 'Third', path: '/third' }] });
  const figures = liveFigures(liveFrame(liveRun()).frame, plan);
  expect(figures.complete).toBe(false);
  expect(figures.rps).toBeNull();
  expect(figures.endpoints.find((e) => e.label === 'r2')).toMatchObject({ live: false, rps: null, share: null });
  expect(readRule(plan.rules[0]!, figures).state).toBe('unknown');
});

it('words thresholds and phases without stating a verdict', () => {
  const plan = readPlan(config);
  const figures = liveFigures(liveFrame(liveRun()).frame, plan);
  const readings = plan.rules.slice(0, 2).map((rule) => readRule(rule, figures));
  expect(thresholdSentence(readings)).toBe('All thresholds are holding. p95 is at most 236 ms against a 250 ms limit.');
  expect(thresholdSentence([])).toBe('No thresholds are set for this revision.');
  expect(phaseOf(liveRun({ state: 'queued' }), false, false)).toBe('waiting');
  expect(phaseOf(liveRun(), false, false)).toBe('starting');
  expect(phaseOf(liveRun(), true, true)).toBe('cancelling');
  expect(phaseOf(liveRun({ state: 'finalizing' }), false, true)).toBe('finalizing');
  expect(headlineOf('running', 'steady', plan.stages[1]!, liveRun())).toBe('Holding 1,200 a second');
  expect(headlineOf('running', 'steady', plan.stages[0]!, liveRun())).toBe('Ramping to 1,200 a second');
});

it('keeps a bounded, de-duplicated history and marks omitted target samples as gaps', () => {
  const plan = readPlan(config);
  const current = liveRun();
  let history = emptyHistory(startedAt);
  const first = liveFrame(current, 1).frame;
  history = appendFrame(history, first, liveFigures(first, plan));
  expect(appendFrame(history, first, liveFigures(first, plan))).toBe(history);
  expect(history.target).toHaveLength(2);
  const later = { ...liveFrame(current, 2, { omitted: 3 }).frame };
  later.target = { ...later.target!, samples: later.target!.samples.map((s) => ({ ...s, observedAtMs: s.observedAtMs + 5000 })) };
  history = appendFrame(history, later, liveFigures(later, plan));
  expect(history.target.map((p) => p.gapBefore)).toEqual([false, false, true, false]);
  expect(history.fromStart).toBe(true);
  let many = emptyHistory(null);
  for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
    const { target: _target, ...rest } = first;
    const next = { ...rest, publishedSequence: i };
    many = appendFrame(many, next, liveFigures(next, plan));
  }
  expect(many.points).toHaveLength(HISTORY_LIMIT);
  expect(many.fromStart).toBe(false);
});

it('formats clocks, latencies and percentages', () => {
  expect(clock(316_000)).toBe('05:16');
  expect(clock(3_723_000)).toBe('1:02:03');
  expect(ms(186.4)).toBe('186 ms');
  expect(ms(9.5)).toBe('9.5 ms');
  expect(percent(0.0004)).toBe('0.04%');
  expect(percent(0.01)).toBe('1%');
});
