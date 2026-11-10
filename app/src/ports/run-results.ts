import type { RunResultSnapshot } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';

/** Scoped projection of the sole verified source manifest. Null means no verified
 * source is available yet; this read never finalizes a run or fabricates a result.
 */
export interface RunResultReader {
  getRunResult(key: RunKey): Promise<RunResultSnapshot>;
}
