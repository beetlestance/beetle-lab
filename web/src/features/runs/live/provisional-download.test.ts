import { expect, it } from 'vitest';
import { frame } from '../live-metrics/fixtures.js';
import { HISTORY_LIMIT, type LivePoint } from './history.js';
import { provisionalDownload, type ProvisionalSnapshot } from './provisional-download.js';

const point: LivePoint = {
  t: 2000,
  archiveSequence: 4,
  feedSourceSequence: null,
  gapBefore: true,
  rps: 0,
  p50: null,
  p95: 42,
  p99: null,
  failedPerSecond: 0,
  vus: null,
  vusMax: 10,
};
const latest = frame();
const runId = 'a7f20000-0000-4000-8000-000000000000';
const snapshot: ProvisionalSnapshot = {
  runId,
  frame: latest,
  points: [point],
  originMs: 1000,
  liveSampled: true,
  coverage: {
    throughTimeMs: 3000,
    windows: 4,
    producerEpoch: latest.producerEpoch,
    subsetDigest: latest.subsetDigest,
    dataArtifactId: runId,
    indexArtifactId: latest.scope.attemptId,
  },
};

it('exports the actual window with run identity, coverage, gap, zero and an empty unknown CSV field', () => {
  const file = provisionalDownload('metrics', snapshot);
  expect(file.filename).toBe(`run-${runId}-provisional-metrics.csv`);
  const [head, data] = file.text
    .trimEnd()
    .split('\r\n')
    .map((row) => row.split(','));
  expect(head).toHaveLength(data!.length);
  const fields = Object.fromEntries(head!.map((key, index) => [key, data![index]]));
  expect(fields).toMatchObject({
    evidence: 'provisional_chart_projection',
    attempt_id: latest.scope.attemptId,
    producer_epoch: latest.producerEpoch,
    archive_windows_available: '4',
    archive_windows_in_export: '1',
    window_end_utc_ms: '3000',
    archive_sequence: '4',
    feed_source_sequence: '',
    gap_before: 'true',
    requests_per_second: '0',
    p50_ms: '',
    p95_ms: '42',
  });
});

it('reports the last retained window and refuses empty or oversized snapshots', () => {
  const file = provisionalDownload('report', snapshot);
  expect(file.text).toContain('latest_retained_window_end_utc_ms: 3000');
  expect(file.text).toContain('p50_ms: unavailable');
  expect(file.text).toContain('not totals or a final outcome');
  expect(() => provisionalDownload('report', { ...snapshot, points: [] })).toThrow('unavailable');
  expect(() => provisionalDownload('metrics', { ...snapshot, points: Array(HISTORY_LIMIT + 1).fill(point) })).toThrow(
    'unavailable',
  );
});
