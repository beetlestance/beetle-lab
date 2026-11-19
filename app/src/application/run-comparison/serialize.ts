import { encodeJson } from '@beetle/contracts';
import { RUN_COMPARISON_BYTES } from '@beetle/contracts/api';
import type { RunComparisonSnapshot } from '@beetle/contracts/api';
/** Optional display detail cannot displace the existing mandatory reply at its unchanged cap. */
export function encodeComparison(value: RunComparisonSnapshot): string {
  try {
    return encodeJson(value, RUN_COMPARISON_BYTES);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'request_limit') throw error;
    const items = value.items.map((item) => {
      if (!item.result) return item;
      const { firstFailedSlo, slos, ...result } = item.result;
      void firstFailedSlo;
      void slos;
      return { ...item, result };
    });
    return encodeJson({ ...value, items }, RUN_COMPARISON_BYTES);
  }
}
