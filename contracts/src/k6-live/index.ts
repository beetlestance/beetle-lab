import { captureLiveMetricSnapshot, captureLiveMetricSubset } from '../api/index.js';
import type { LiveMetricHash, LiveMetricScope, LiveMetricSubset } from '../api/index.js';
import { encodeCanonicalJson } from '../json.js';
import { k6MetricCatalogue, k6MetricLayout } from '../k6-metrics/index.js';
import type { K6MetricShape } from '../k6-metrics/index.js';
import type { K6LiveApproval, K6LiveAssignment } from './types.js';
export type { K6LiveApproval, K6LiveAssignment } from './types.js';
/** Trusted image metadata only; never a suite/Offer option. */
export const K6_LIVE_METRIC_IMAGE_ENV = 'BEETLE_K6_LIVE_METRICS_V2';
/** Virtual output-only series. No native sample uses this name. */
export const K6_LIVE_CHECKS = 'beetle_checks_passing';
const checksRow = { metric: K6_LIVE_CHECKS, kind: 'rate', scope: 'execute', tags: { phase: 'execute' } } as const;
export class K6LiveApprovalError extends Error {
  constructor() {
    super('K6 live approval rejected');
    this.name = 'K6LiveApprovalError';
  }
}
const priorities = [
  'http_req_duration',
  'http_req_failed',
  'beetle_requests',
  'beetle_required_failures',
  'beetle_transport_failures',
  'beetle_execution_failures',
  'vus',
  'vus_max',
  'dropped_iterations',
  'iterations',
  'data_sent',
  'data_received',
  'beetle_assertion_failures',
];
/** Endpoint rows a live table can show: duration (count, p50, p95) and failure rate per request. */
export const K6_LIVE_ENDPOINT_ROWS = 6;
/** Same catalogue as parser/runtime; prepare/control remain excluded from live selection. */
export function k6LiveSubset(source: K6MetricShape): LiveMetricSubset {
  const approved = k6MetricCatalogue(k6MetricLayout(source));
  const eligible = approved.filter(
    (item) => (item.scope === 'execute' || item.scope === 'engine') && item.tags.phase !== 'prepare',
  );
  const endpoints = [...new Set(eligible.flatMap((item) => (item.tags.request ? [item.tags.request] : [])))];
  const rows = endpoints.slice(0, K6_LIVE_ENDPOINT_ROWS).flatMap((request) =>
    ['http_req_duration', 'http_req_failed'].flatMap((metric) => {
      const row = eligible.find(
        (item) => item.metric === metric && item.tags.request === request && !item.tags.assertion,
      );
      return row ? [row] : [];
    }),
  );
  const preferred = [
    ...rows,
    ...(eligible.some((item) => item.metric === 'checks') ? [checksRow] : []),
    ...priorities.flatMap((metric) => {
      const row = rows.some((item) => item.metric === metric)
        ? undefined
        : eligible.find((item) => item.metric === metric);
      return row ? [row] : [];
    }),
  ];
  const selected = [...preferred, ...eligible.filter((item) => !preferred.includes(item))]
    .slice(0, 20)
    .map((item, ordinal) => ({ ...item, ordinal }));
  const nativeSelected = selected.filter((item) => item.metric !== K6_LIVE_CHECKS).length;
  const subset = captureLiveMetricSubset({ selected, excludedSeries: approved.length - nativeSelected });
  for (const item of subset.selected) {
    Object.freeze(item.tags);
    Object.freeze(item);
  }
  Object.freeze(subset.selected);
  return Object.freeze(subset);
}
/** One durably single-start logical producer per unique launch. This UUID is not authentication. */
export function createK6LiveApproval(input: {
  source: K6MetricShape & { readonly targetSampling?: { readonly intervalMs: number } | null };
  scope: LiveMetricScope;
  assignment: K6LiveAssignment;
  hash: LiveMetricHash;
}): K6LiveApproval {
  try {
    if (!fingerprint(input.assignment.specDigest) || !fingerprint(input.assignment.intentDigest))
      throw new K6LiveApprovalError();
    const subset = k6LiveSubset(input.source);
    const hash = input.hash;
    const base = captureLiveMetricSnapshot(
      {
        version: 1,
        scope: input.scope,
        producerEpoch: '00000000-0000-4000-8000-000000000001',
        subset,
        subsetDigest: hash(encodeCanonicalJson(subset, 16384)),
        sourceSequence: 1,
        publishedSequence: 1,
        coalescedWindows: 0,
        capturedAtMs: 0,
        publishedAtMs: 0,
        startTimeMs: 0,
        endTimeMs: 1000,
        upstreamCoverage: 'unknown',
        series: [],
      },
      hash,
    );
    const scope = {
      ...base.scope,
      organizationId: base.scope.organizationId.toLowerCase(),
      workspaceId: base.scope.workspaceId.toLowerCase(),
      attemptId: base.scope.attemptId.toLowerCase(),
    };
    const digest = hash(
      encodeCanonicalJson(
        {
          purpose: 'beetle-lab.k6-live-epoch.v1',
          scope,
          specDigest: input.assignment.specDigest,
          intentDigest: input.assignment.intentDigest,
        },
        4096,
      ),
    );
    const producerEpoch = epoch(digest);
    return Object.freeze({
      scope: Object.freeze(scope),
      producerEpoch,
      subset,
      targetIntervalMs: targetInterval(input.source.targetSampling),
    });
  } catch {
    throw new K6LiveApprovalError();
  }
}
function epoch(digest: string): string {
  if (!fingerprint(digest)) throw new K6LiveApprovalError();
  const value =
    digest.slice(0, 12) +
    '8' +
    digest.slice(13, 16) +
    ((Number.parseInt(digest[16]!, 16) & 3) | 8).toString(16) +
    digest.slice(17, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function targetInterval(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const interval = (value as { intervalMs?: unknown }).intervalMs;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1000 || interval > 60000)
    throw new K6LiveApprovalError();
  return interval;
}
function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export {
  decodeK6HistoryCheckpoint,
  encodeK6HistoryCheckpoint,
  K6_HISTORY_CHECKPOINT_NAMES,
  K6_HISTORY_CHECKPOINT_SLOT_BYTES,
} from './checkpoint.js';
