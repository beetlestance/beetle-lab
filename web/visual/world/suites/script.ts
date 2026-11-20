// Exported k6 scripts and their export jobs, for the Script page and the Export script overlays.
import { createHash } from 'node:crypto';
import type { Route } from '@playwright/test';
import type { Api, Json } from '../../harness.js';
import { fixture } from '../index.js';
import { at } from './data.js';
import type { Obj } from './data.js';
import { apiBase, hex, scope, steady, uuid } from './ids.js';
import { safeError } from './wire.js';

interface Shape {
  ordinal: number;
  peak: number;
  vus: number;
  p99: boolean;
}
export const shapes: Shape[] = [
  { ordinal: 1, peak: 1000, vus: 200, p99: false },
  { ordinal: 2, peak: 1000, vus: 240, p99: false },
  { ordinal: 3, peak: 1000, vus: 240, p99: true },
  { ordinal: 4, peak: 1200, vus: 240, p99: true },
];

/** The standalone script of steady-1.2k at one revision; revisions differ in rate, VUs and the p99 line. */
export function scriptText({ ordinal, peak, vus, p99 }: Shape): string {
  const lines = [
    `// steady-1.2k, revision ${ordinal}. Exported from Beetle Lab.`,
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    "import { SharedArray } from 'k6/data';",
    "import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';",
    '',
    "const BASE = __ENV.TARGET || 'http://checkout-api:8080';",
    "const JSON_HEADERS = { 'Content-Type': 'application/json' };",
    "const rows = new SharedArray('users.csv', () => papaparse.parse(open('./users.csv'), { header: true }).data);",
    'const bodies = {',
    "  'cart-item.json': open('./cart-item.json'),",
    "  'checkout.json': open('./checkout.json'),",
    '};',
    '',
    'export const options = {',
    '  scenarios: {',
    '    main: {',
    "      executor: 'ramping-arrival-rate',",
    "      startRate: 10, timeUnit: '1s',",
    `      preAllocatedVUs: ${vus / 2},`,
    `      maxVUs: ${vus},`,
    '      stages: [',
    `        { target: ${peak}, duration: '60s' },`,
    `        { target: ${peak}, duration: '480s' },`,
    "        { target: 10, duration: '60s' },",
    '      ],',
    '    },',
    '  },',
    '  thresholds: {',
    "    'http_req_duration': ['p(95)<250'" + (p99 ? ", 'p(99)<300'" : '') + '],',
    "    'http_req_failed': ['rate<0.01'],",
    "    'checks': ['rate>0.99'],",
    '  },',
    '};',
    '',
    'export default function () {',
    '  const user = rows[(__VU - 1) % rows.length];',
    "  const cart = http.post(`${BASE}/cart/items`, bodies['cart-item.json'], { headers: JSON_HEADERS });",
    "  check(cart, { 'status is 201': (r) => r.status === 201 });",
    '}',
    '',
  ];
  return lines.join('\n');
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export type JobState = 'ready' | 'queued' | 'dispatching' | 'generating' | 'publishing' | 'unknown' | 'none';
/** One export job of steady-1.2k at revision `ordinal` in the given state. */
export function exportJob(ordinal: number, state: Exclude<JobState, 'none'>): Obj {
  const shape = shapes[ordinal - 1]!;
  const text = scriptText(shape);
  const ready = state === 'ready';
  const requested = ready ? at('11-07 05:41') : '2026-11-07T23:39:48.000Z';
  return {
    ...fixture('export-job'),
    id: uuid(7, ordinal),
    scope,
    suiteId: steady.id,
    revisionId: steady.revisions[ordinal - 1]!,
    revisionDigest: hex('abcd'[ordinal - 1]!),
    requestedAt: requested,
    activeAttemptId: uuid(7, 50 + ordinal),
    state,
    reason: state === 'unknown' ? 'publication_unknown' : null,
    cancellationRequested: false,
    engine: { id: 'k6', profileId: 'k6-export', imageDigest: `sha256:${hex('e')}`, configVersion: 1 },
    budget: {
      cpuMillis: 2000,
      memoryBytes: 4 * 1024 ** 3,
      pids: 512,
      timeoutMs: 1_800_000,
      outputBytes: 64 * 1024 ** 2,
    },
    options: { scriptTimeoutMs: 1_800_000, maximumBuildBytes: 1_048_576 },
    artifact: ready
      ? {
          artifactId: uuid(8, ordinal),
          name: 'suite.js',
          mediaType: 'text/javascript',
          bytes: Buffer.byteLength(text),
          sha256: sha(text),
        }
      : null,
    ...(ready ? { madeAt: at('11-07 05:42') } : {}),
    ...(state === 'unknown' ? { lastAgentReportAt: '2026-11-07T23:34:00.000Z' } : {}),
  };
}

/** Which revisions have which export: `{ 1: 'ready', 4: 'ready' }`; absent revisions have none yet. */
export type ExportStates = Partial<Record<1 | 2 | 3 | 4, JobState>>;

/** Latest-export reads, job reads and the verified script bytes for the Script page and its overlays. */
export function scriptWorld(api: Api, states: ExportStates = { 1: 'ready', 4: 'ready' }): Api {
  const job = (ordinal: number) => {
    const state = states[ordinal as 1];
    return !state || state === 'none' ? null : exportJob(ordinal, state);
  };
  api
    .on('getLatestRevisionExport', (call) => {
      const ordinal = steady.revisions.indexOf(call.params.revisionId!) + 1;
      return { scope, revisionId: call.params.revisionId!, job: ordinal ? (job(ordinal) as Json) : null };
    })
    .on('getExport', (call) => {
      const ordinal = Number(call.params.exportId!.slice(-1));
      return (job(ordinal) as Json) ?? safeError('not_found', 'Not found', 404);
    })
    .on('getExportProfiles', { ...fixture('export-profiles'), scope })
    .on('getRun', (call) => {
      const run = fixture<Obj>('run');
      return { ...run, id: call.params.runId!, scope, suiteId: steady.id, revisionId: steady.revisions[0]! };
    });
  api.route(new RegExp(`^${apiBase}/exports/[^/]+/content`), async (route: Route) => {
    const ordinal = Number(new URL(route.request().url()).pathname.split('/').at(-2)!.slice(-1));
    const body = scriptText(shapes[ordinal - 1]!);
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body,
      headers: { 'cache-control': 'no-store' },
    });
  });
  return api;
}
