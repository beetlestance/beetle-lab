import { DistributionError } from '@beetle/contracts/metrics';
import { encodeJson } from '@beetle/contracts';
import type { RunKey } from '../../ports/runs.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { K6HttpSummaryError, summarizeK6HttpTotals, k6RequestsPerSecond } from '@beetle/contracts/k6-history';
import { pendingRunHistoryMetrics } from '@beetle/contracts/api';
import type { RunHistoryProjection } from '../../ports/run-history.js';
import type { Publication } from './archive.js';
import { fail } from './values.js';

export function historyProjection(publication: Publication): RunHistoryProjection {
  const base = pendingRunHistoryMetrics();
  const page = publication.page;
  const publishedArtifactBytes = page.availability === 'ready' ? artifactBytes(page.items) : null;
  const archive = publication.archive;
  if (!archive) return { ...base, publishedArtifactBytes, availability: unavailable(publication) };
  const artifact = page.items.find(item => item.kind === 'numeric-final');
  if (!artifact || !page.manifestDigest) return fail();
  const numeric = archive.numeric;
  const totals = httpTotals(numeric.totals);
  return { ...base, ...totals, availability: 'ready', publishedArtifactBytes,
    testDurationMs: numeric.testDurationMs, requestsPerSecond: k6RequestsPerSecond(totals.requestCount, numeric.testDurationMs),
    source: { generation: 1, manifestDigest: page.manifestDigest, numericArtifactId: artifact.artifactId,
      numericSha256: artifact.sha256, numericVersion: numeric.version, measurementSourceTimeMs: numeric.sourceTimeMs, coverage: numeric.coverage } };
}
function artifactBytes(items: Publication['page']['items']): number {
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  if (!Number.isSafeInteger(bytes)) return fail();
  return bytes;
}
function unavailable(p: Publication): RunHistoryProjection['availability'] {
  if (p.page.availability === 'pending') return 'pending';
  if (p.reason === 'unsupported_format') return 'unsupported_format';
  if (p.page.availability === 'absent' || p.reason === 'not_recorded') return 'not_recorded';
  return 'unavailable';
}

export function captureHistoryKey(input: unknown): RunKey & { attemptId: string } {
  try {
    const copy = JSON.parse(encodeJson(input, 4096)) as RunKey & { attemptId: string };
    if (!copy || Object.keys(copy).length !== 3 || Object.keys(copy).some(key => !['id', 'scope', 'attemptId'].includes(key))) throw new Error('shape');
    return copy;
  } catch { throw new MetricReadError('invalid_input'); }
}

function httpTotals(input: Parameters<typeof summarizeK6HttpTotals>[0]) {
  try { return summarizeK6HttpTotals(input); }
  catch (error) { if (error instanceof K6HttpSummaryError || error instanceof DistributionError) return fail(); throw error; }
}
