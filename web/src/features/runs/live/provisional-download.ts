import type { Latest } from './current.js';
import { HISTORY_LIMIT } from './history.js';
import type { LiveHistory, LivePoint } from './history.js';
import { recordedCount } from './backfill.js';

export type ProvisionalSnapshot = { readonly runId: string } & Pick<Latest, 'frame'> &
  Pick<LiveHistory, 'points' | 'originMs' | 'coverage' | 'liveSampled'>;
export type DownloadKind = 'report' | 'metrics';

export function provisionalSnapshot(
  runId: string,
  latest: Latest | null,
  history: LiveHistory,
): ProvisionalSnapshot | null {
  if (!latest || !history.points.length) return null;
  const { points, originMs, coverage, liveSampled } = history;
  return { runId, frame: latest.frame, points, originMs, coverage, liveSampled };
}

const columns = [
  'requests_per_second',
  'p50_ms',
  'p95_ms',
  'p99_ms',
  'failed_per_second',
  'active_vus',
  'allocated_vus',
] as const;

function readings(point: LivePoint) {
  return [point.rps, point.p50, point.p95, point.p99, point.failedPerSecond, point.vus, point.vusMax];
}

const cell = (value: number | null) => (value !== null && Number.isFinite(value) ? String(value) : '');

/** Export a bounded projection of this page's accepted stream. No new read or artifact write. */
export function provisionalDownload(kind: DownloadKind, snapshot: ProvisionalSnapshot) {
  const { runId, frame, points, originMs, coverage, liveSampled } = snapshot;
  if (!points.length || points.length > HISTORY_LIMIT || !Number.isFinite(originMs))
    throw Error('Live observations unavailable');
  const identity = [
    ['organization_id', frame.scope.organizationId],
    ['workspace_id', frame.scope.workspaceId],
    ['run_id', runId],
    ['attempt_id', frame.scope.attemptId],
    ['generation', frame.scope.generation],
    ['producer_epoch', frame.producerEpoch],
    ['subset_sha256', frame.subsetDigest],
    ['latest_frame_end_utc_ms', frame.endTimeMs],
    ['archive_through_utc_ms', coverage?.throughTimeMs ?? ''],
    ['archive_windows_available', coverage?.windows ?? ''],
    ['archive_windows_in_export', coverage ? recordedCount(snapshot) : ''],
    ['live_windows_sampled', liveSampled],
  ] as const;
  const file = 'run-' + runId + '-provisional';
  if (kind === 'metrics') {
    const rows = points.map((point) =>
      [
        ...identity.map(([, value]) => value),
        originMs + point.t,
        point.archiveSequence ?? '',
        point.feedSourceSequence ?? '',
        point.gapBefore,
        ...readings(point).map(cell),
      ].join(','),
    );
    return {
      filename: file + '-metrics.csv',
      type: 'text/csv;charset=utf-8',
      text:
        [
          [
            'evidence',
            ...identity.map(([key]) => key),
            'window_end_utc_ms',
            'archive_sequence',
            'feed_source_sequence',
            'gap_before',
            ...columns,
          ].join(','),
          ...rows.map((row) => 'provisional_chart_projection,' + row),
        ].join('\r\n') + '\r\n',
    };
  }
  const latest = points.at(-1)!;
  return {
    filename: file + '-report.txt',
    type: 'text/plain;charset=utf-8',
    text:
      [
        'Beetle Lab — provisional report',
        'This page contains a bounded view of received chart observations. Coverage can be partial or sampled.',
        'Latency columns contain pooled estimates when available and otherwise the slowest endpoint estimate.',
        'The report contains the latest retained window, not totals or a final outcome.',
        ...identity.map(([key, value]) => key + ': ' + (value === '' ? 'unavailable' : value)),
        'retained_windows: ' + points.length,
        'latest_retained_window_end_utc_ms: ' + (originMs + latest.t),
        ...readings(latest).map((value, index) => columns[index] + ': ' + (cell(value) || 'unavailable')),
      ].join('\n') + '\n',
  };
}
