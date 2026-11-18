import type { ExportJob } from '@beetle/contracts/api';
import { maximumShownScriptBytes } from '../exports/scriptText.js';
import type { Comparison, ScriptSide } from './comparison-model.js';
import type { Diff } from './diff.js';
const missing = (job: ExportJob | undefined) => !job || ['failed', 'cancelled', 'unknown'].includes(job.state);

/** A ready comparison requires actual verified bytes on both sides; no config substitute. */
export function sourceState(
  current: ScriptSide,
  other: ScriptSide,
  diff: Diff | null | undefined,
): Comparison['status'] {
  if (current.failed || other.failed) return 'error';
  if (current.pending || other.pending) return 'loading';
  if (missing(current.job) || missing(other.job)) return 'missing';
  return readyState(current, other, diff);
}
function readyState(current: ScriptSide, other: ScriptSide, diff: Diff | null | undefined): Comparison['status'] {
  if (current.job?.state !== 'ready' || other.job?.state !== 'ready') return 'preparing';
  if (current.job.artifact.bytes > maximumShownScriptBytes || other.job.artifact.bytes > maximumShownScriptBytes)
    return 'too_large';
  if (diff === undefined) return 'loading';
  return diff === null ? 'too_large' : 'ready';
}
