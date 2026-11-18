import { DistributionError } from '@beetle/contracts/metrics';
import { isK6ExecuteRequest } from '@beetle/contracts/k6-history';
import type { RunLatencyAttribution } from '@beetle/contracts/api';
import type { RunMetricSeriesQuery } from '../../ports/run-metrics.js';
import { HISTORY_SCAN_LIMITS, scanArchiveWindows } from './scan.js';
import type { Publication, ReadyArchive } from './archive.js';
import { unavailable } from './history.js';
import type { ArchiveIO } from './io.js';
import { RISE, riseOf, risePoint } from './rise.js';
import type { RisePoint } from './rise.js';
import { fail } from './values.js';

/** Whole-history read bounds: one verified sequential pass, no index scan. */
export const LATENCY_LIMITS = Object.freeze({ ...HISTORY_SCAN_LIMITS, requests: 64 });
type Outcome = Pick<RunLatencyAttribution, 'rise' | 'reason'>;

function precheck(a: ReadyArchive): Outcome | null {
  if (!a.numeric.coverage.complete) return { rise: null, reason: 'incomplete_coverage' };
  const requests = new Set(
    a.numeric.totals
      .filter((s) => s.metric === 'http_req_duration' && isK6ExecuteRequest(s))
      .map((s) => s.tags.request),
  );
  if (
    a.numeric.windows > LATENCY_LIMITS.windows ||
    a.data.artifact.bytes > LATENCY_LIMITS.dataBytes ||
    requests.size > LATENCY_LIMITS.requests
  )
    return { rise: null, reason: 'too_large' };
  if (a.numeric.windows < 3 * RISE.baselineWindows) return { rise: null, reason: 'too_few_windows' };
  return null;
}
async function points(io: ArchiveIO, a: ReadyArchive): Promise<RisePoint[]> {
  const result: RisePoint[] = [];
  await scanArchiveWindows(io, a, (window) => {
    result.push(risePoint(window));
  });
  return result;
}
async function outcome(io: ArchiveIO | undefined, p: Publication): Promise<Outcome> {
  if (!p.archive) {
    const reason = unavailable(p);
    return { rise: null, reason: reason === 'ready' ? 'unavailable' : reason };
  }
  if (!io) return fail();
  const refused = precheck(p.archive);
  if (refused) return refused;
  try {
    return riseOf(await points(io, p.archive));
  } catch (error) {
    if (error instanceof DistributionError) return fail();
    throw error;
  }
}
/** Derived from the published 1 s HTTP duration history only; null rise means "not stated". */
export async function latencyAttribution(
  q: RunMetricSeriesQuery,
  p: Publication,
  io: ArchiveIO | undefined,
): Promise<RunLatencyAttribution> {
  const result = await outcome(io, p);
  return {
    id: q.id,
    scope: q.scope,
    attemptId: q.attemptId,
    generation: 1,
    manifestDigest: p.page.manifestDigest ?? null,
    windows: p.archive?.numeric.windows ?? 0,
    ...result,
  };
}
