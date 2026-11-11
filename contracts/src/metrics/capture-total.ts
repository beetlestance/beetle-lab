import { validateDistribution } from './distribution-validation.js';
import type { NumericTotal } from './series-types.js';
import { integer, numeric, object, invalid } from './capture-fields.js';
export function captureTotal(input: unknown): NumericTotal {
  const base = object(input, ['kind'], ['sum', 'numerator', 'sampleCount', 'count', 'min', 'max', 'mean', 'distribution', 'latest', 'sourceTimeMs']);
  switch (base.kind) {
    case 'counter': { const v = object(input, ['kind', 'sum']); return {kind: 'counter', sum: integer(v.sum)}; }
    case 'rate': {
      const v = object(input, ['kind', 'numerator', 'sampleCount']);
      const numerator = integer(v.numerator); const sampleCount = integer(v.sampleCount);
      if (numerator > sampleCount) return invalid(); return {kind: 'rate', numerator, sampleCount};
    }
    case 'gauge': {
      const v = object(input, ['kind', 'latest', 'sourceTimeMs', 'min', 'max']);
      const latest = numeric(v.latest); const min = numeric(v.min); const max = numeric(v.max);
      if (latest < min || latest > max) return invalid();
      return {kind: 'gauge', latest, min, max, sourceTimeMs: integer(v.sourceTimeMs, 8640000000000000)};
    }
    case 'trend': return trend(input);
    default: return invalid();
  }
}
function trend(input: unknown): NumericTotal {
  const v = object(input, ['kind', 'count', 'sum', 'min', 'max', 'mean', 'distribution']);
  const count = integer(v.count); const sum = numeric(v.sum); const min = numeric(v.min); const max = numeric(v.max); const mean = numeric(v.mean);
  const distribution = validateDistribution(v.distribution);
  if (!count || min > max || mean !== sum / count || distribution.count !== count
    || distribution.min !== min || distribution.max !== max) return invalid();
  exactPopulation(count, sum, min, max);
  return {kind: 'trend', count, sum, min, max, mean, distribution: {...distribution, buckets: [...distribution.buckets]}};
}
function exactPopulation(count: number, sum: number, min: number, max: number): void {
  if (count === 1 && (sum !== min || sum !== max)) return invalid();
  if (max === 0 && sum !== 0) return invalid();
}
