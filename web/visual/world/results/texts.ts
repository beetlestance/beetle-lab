// Bytes of the published artifacts: the plain-text report, CSV, JSON summaries and k6 script.
import type { Json } from '../../harness.js';
import type { Variant } from './data.js';
import type { Profile } from './profiles.js';
import type { Timing } from './series.js';
import { requestsOf } from './series.js';

interface Input {
  profile: Profile;
  variant: Variant;
  timing: Timing;
  ids: { run: string; attempt: string };
  target: Json;
  scope: { organizationId: string; workspaceId: string };
}
const pad = (label: string, value: string) => `  ${label.padEnd(32)}${value}`;
const clock = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const outcomes: Record<Variant, string> = {
  passed: 'PASSED',
  failed: 'FAILED',
  cancelled: 'CANCELLED at ',
  oom: 'ERRORED, out of memory',
  'output-full': 'ERRORED, output full',
  incomplete: 'ERRORED, metrics archive incomplete',
};

export function reportText({ profile: p, variant: v, timing: t, ids }: Input): string {
  const total = requestsOf(p, t.ranMs);
  const verdict = v === 'cancelled' ? `${outcomes[v]}${clock(t.ranMs)}` : outcomes[v];
  const judged = v === 'passed' || v === 'failed';
  const mark = (ok: boolean) => (judged ? (ok ? 'PASS' : 'FAIL') : '—   ');
  const lines = [
    'BEETLE LAB RUN REPORT',
    '',
    pad('Suite', `${p.suiteName}, revision ${p.ordinal} (config ${p.digest.slice(0, 8)})`),
    pad('Run', `${ids.run.slice(0, 4)}, started ${new Date(t.startedMs).toISOString().replace('.000', '')}`),
    pad('Target', p.target),
    pad('Outcome', verdict),
    pad('Length', clock(t.ranMs)),
    '',
    'TRAFFIC',
    pad('Requests', total.toLocaleString('en-US')),
    pad('Requests a second', `${p.rps.toLocaleString('en-US')} (peak ${p.peak.toLocaleString('en-US')})`),
    pad('Latency p50 / p95 / p99', `${p.p50} / ${p.p95} / ${p.p99} ms`),
    pad('Failed requests', `${(p.failRatio * 100).toFixed(2)}%`),
    pad('Checks passed', `${(p.checkRatio * 100).toFixed(2)}%`),
    '',
    'THRESHOLDS',
    ...p.slos.map((s) => {
      const ok = s.operator === '<' ? s.reading < s.value : s.reading > s.value;
      const shown = s.metric === 'http_req_duration' ? `${s.reading} ms` : `${(s.reading * 100).toFixed(2)}%`;
      return (
        `  ${mark(ok)}  ${s.id.padEnd(8)}${s.operator} ${s.metric === 'http_req_duration' ? `${s.value} ms` : `${s.value * 100}%`}`.padEnd(
          40,
        ) + shown
      );
    }),
    '',
    'SLOWEST ENDPOINTS (p95)',
  ];
  if (v === 'incomplete') lines.push('  unavailable: metrics archive not verified');
  else {
    for (const e of [...p.endpoints].sort((a, b) => b.p95 - a.p95).slice(0, 10))
      lines.push(`  ${e.name.padEnd(30)}${e.p95} ms, ${(e.failed * 100).toFixed(2)}% failed`);
    if (p.endpoints.length > 10) lines.push(`  …and ${p.endpoints.length - 10} more in metrics.csv`);
  }
  return `${lines.join('\n')}\n`;
}

function csv({ profile: p, timing: t }: Input): string {
  const rows = ['elapsed_s,requests,failed,p50_ms,p95_ms,p99_ms,vus'];
  for (let s = 0; s * 5000 < t.ranMs; s++) {
    const ramp = Math.min(1, (s * 5000 + 5000) / p.rampMs);
    rows.push(
      [
        s * 5,
        Math.round(p.rps * 5 * ramp),
        Math.round(p.rps * 5 * ramp * p.failRatio),
        Math.round(p.p50 * (0.7 + 0.3 * ramp)),
        Math.round(p.p95 * (0.6 + 0.4 * ramp)),
        Math.round(p.p99 * (0.6 + 0.4 * ramp)),
        Math.round(p.vusBusy * ramp),
      ].join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}

function script(p: Profile): string {
  return `import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    main: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: ${p.vusMax},
      stages: [
        { duration: '${p.rampMs / 1000}s', target: ${p.rps} },
        { duration: '${(p.durationMs - p.rampMs) / 1000}s', target: ${p.rps} },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<${p.slos[0]!.value}'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const res = http.get('${p.target}${p.endpoints[0]!.path.replace('{id}', '42')}');
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;
}

export function artifactBodies(input: Input): Record<string, string> {
  const { profile: p, timing: t, ids, scope } = input;
  const total = requestsOf(p, t.ranMs);
  const owner = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    attemptId: ids.attempt,
    generation: 1,
  };
  return {
    'standalone-k6-script': script(p),
    'performance-report': reportText(input),
    'metrics-csv': csv(input),
    'numeric-final': JSON.stringify(
      {
        durationMs: t.ranMs,
        requests: total,
        requestsPerSecond: p.rps,
        latencyMs: { p50: p.p50, p95: p.p95, p99: p.p99 },
        failedRatio: p.failRatio,
        checksRatio: p.checkRatio,
        thresholds: p.slos.map((s) => ({ id: s.id, reading: s.reading })),
      },
      null,
      2,
    ),
    'k6-diagnostics': JSON.stringify({
      format: 'beetle-k6-diagnostics',
      version: 1,
      scope: owner,
      coverage: 'complete',
      observedBytes: 412,
      invalidSegments: 0,
      redactedRecords: 1,
      droppedRecords: 0,
      records: [
        { sequence: 1, level: 'warning', code: 'insufficient-vus' },
        { sequence: 2, level: 'warning', code: 'insufficient-vus' },
        { sequence: 3, level: 'info', code: 'redacted' },
      ],
      observedRecords: 3,
    }),
    'k6-warnings': JSON.stringify({
      format: 'beetle-k6-warnings',
      version: 1,
      scope: owner,
      native: {
        coverage: 'complete',
        insufficientVus: 2,
        highCardinality: 0,
        maxDuration: 0,
        otherWarnings: 0,
        discardedSegments: 0,
      },
      configuration: {
        scenarioCount: 1,
        arrival: {
          executor: 'ramping-arrival-rate',
          peakIterationsPerSecond: p.rps,
          preAllocatedVUs: 100,
          maxVUs: p.vusMax,
        },
      },
      iteration: { estimate: 118, lower: 116, upper: 120, count: total },
    }),
    'target-runtime': JSON.stringify(input.target),
  };
}
