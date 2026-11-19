import { DistributionError } from '@beetle/contracts/metrics';
import type { MetricWindow } from '@beetle/contracts/metrics';
import { isK6ExecuteRequest, K6HttpSummaryError } from '@beetle/contracts/k6-history';
import { chartSampleOrdinals, recordedValueMean } from '@beetle/contracts/api';
import type { RunChartHistory, RunChartPoint } from '@beetle/contracts/api';
import type { RunMetricSeriesQuery } from '../../ports/run-metrics.js';
import type { Publication, ReadyArchive } from './archive.js';
import type { ArchiveIO } from './io.js';
import { historyProjection, unavailable } from './history.js';
import { httpTraffic } from './overview.js';
import { HISTORY_SCAN_LIMITS, scanArchiveWindows } from './scan.js';
import { fail } from './values.js';
function tooLarge(archive: ReadyArchive): boolean {
  const requests = new Set(archive.numeric.totals.filter(isK6ExecuteRequest).map((item) => item.tags.request));
  return (
    archive.numeric.windows > HISTORY_SCAN_LIMITS.windows ||
    archive.data.artifact.bytes > HISTORY_SCAN_LIMITS.dataBytes ||
    requests.size > 64
  );
}
function gauge(window: MetricWindow, name: string): number | null {
  const row = window.series.find(
    (item) => item.metric === name && item.scope === 'engine' && Object.keys(item.tags).length === 0,
  );
  if (!row) return null;
  return row.total.kind === 'gauge' ? row.total.latest : fail();
}
function point(window: MetricWindow, sequence: number, previous: RunChartPoint | undefined): RunChartPoint {
  if (window.endTimeMs - window.startTimeMs !== 1000) return fail();
  return {
    sequence,
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
    gapBefore: previous ? window.startTimeMs - previous.endTimeMs !== (sequence - previous.sequence - 1) * 1000 : false,
    ...httpPoint(window),
    vus: gauge(window, 'vus'),
    vusMax: gauge(window, 'vus_max'),
  };
}
async function readPoints(io: ArchiveIO, archive: ReadyArchive) {
  const selected = new Set(chartSampleOrdinals(archive.numeric.windows));
  const points: RunChartPoint[] = [];
  let peak: number | null = null;
  let knownRequestWindows = 0;
  const vus: number[] = [];
  let firstStart: number | undefined;
  let lastEnd = 0;
  await scanArchiveWindows(io, archive, (window, sequence) => {
    const current = point(window, sequence, points.at(-1));
    firstStart ??= current.startTimeMs;
    lastEnd = current.endTimeMs;
    if (current.vus !== null) vus.push(current.vus);
    if (current.requestCount !== null) {
      peak = Math.max(peak ?? 0, current.requestCount);
      knownRequestWindows++;
    }
    if (selected.has(sequence)) points.push(current);
  });
  const contiguous = firstStart !== undefined && lastEnd - firstStart === archive.numeric.windows * 1000;
  const meanVus =
    archive.numeric.coverage.complete && contiguous && vus.length === archive.numeric.windows
      ? recordedValueMean(vus)
      : null;
  return { points, observedPeakRequestsPerSecond: peak, knownRequestWindows, meanVus, knownVusWindows: vus.length };
}
export async function chartHistory(
  q: RunMetricSeriesQuery,
  publication: Publication,
  io: ArchiveIO | undefined,
): Promise<RunChartHistory> {
  const archive = publication.archive;
  const base: RunChartHistory = {
    id: q.id,
    scope: q.scope,
    attemptId: q.attemptId,
    source: historyProjection(publication).source,
    windows: archive?.numeric.windows ?? 0,
    sampled: false,
    points: [],
    observedPeakRequestsPerSecond: null,
    knownRequestWindows: 0,
    meanVus: null,
    knownVusWindows: 0,
    reason: null,
  };
  if (!archive) {
    const reason = unavailable(publication);
    return { ...base, reason: reason === 'ready' ? 'unavailable' : reason };
  }
  if (tooLarge(archive)) return { ...base, reason: 'too_large' };
  if (!io) return fail();
  try {
    const read = await readPoints(io, archive);
    return { ...base, ...read, sampled: archive.numeric.windows > 900 };
  } catch (error) {
    if (error instanceof DistributionError || error instanceof K6HttpSummaryError) return fail();
    throw error;
  }
}

function httpPoint(window: MetricWindow) {
  const traffic = httpTraffic(window.series, 1000);
  return {
    requestCount: traffic.requestCount,
    httpFailures: traffic.failure ? traffic.failure.numerator : null,
    httpSamples: traffic.failure ? traffic.failure.sampleCount : null,
    ...percentiles(traffic.latency),
  };
}
function percentiles(latency: ReturnType<typeof httpTraffic>['latency']) {
  if (!latency) return { httpP50: null, httpP95: null, httpP99: null };
  return { httpP50: latency.percentiles.p50, httpP95: latency.percentiles.p95, httpP99: latency.percentiles.p99 };
}
