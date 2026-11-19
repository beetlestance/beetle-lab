import { encodeCanonicalJson } from '../../json.js';
import type { RunComparisonResult, RunComparisonSlo } from '../generated/types.js';
/** Compact native facts stay internally consistent; readings never regrade verdicts. */
export function comparisonSlosMatch(result: RunComparisonResult): boolean {
  const slos = result.slos;
  if (slos === undefined) return true;
  if (new Set(slos.map((s) => s.id)).size !== slos.length) return false;
  if (slos.filter((s) => !s.passed).length !== result.failedSloCount) return false;
  if (!slos.every(readingMatches)) return false;
  const detail = result.firstFailedSlo;
  if (!detail) return true;
  const first = slos.find((s) => !s.passed);
  if (!first) return false;
  return (
    encodeCanonicalJson(detail, 2048) ===
    encodeCanonicalJson({ id: first.id, reading: first.reading, limit: first.limit }, 2048)
  );
}
function readingMatches(slo: RunComparisonSlo): boolean {
  return !slo.reading || !slo.limit || (slo.reading.metric === slo.limit.metric && slo.reading.stat === slo.limit.stat);
}
