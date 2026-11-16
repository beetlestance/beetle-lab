import type { SeriesTotal } from './series-types.js';
import { captureTotal } from './capture-total.js';
import { object, text, invalid } from './capture-fields.js';
export function captureMetricSeries(input: unknown): SeriesTotal {
  const v = object(input, ['metric', 'kind', 'tags', 'total', 'scope']);
  const metric = text(v.metric, /^[A-Za-z_][A-Za-z0-9_:]*$/);
  const raw = object(v.tags, [], ['phase', 'request', 'assertion']); const tags: {phase?: 'prepare' | 'execute'; request?: string; assertion?: string} = {};
  if (raw.phase !== undefined) {
    if (raw.phase !== 'prepare' && raw.phase !== 'execute') return invalid(); tags.phase = raw.phase;
  }
  if (raw.request !== undefined) tags.request = text(raw.request, /^[A-Za-z0-9_.:-]+$/);
  if (raw.assertion !== undefined) tags.assertion = text(raw.assertion, /^[A-Za-z0-9_.:-]+$/);
  const total = captureTotal(v.total);
  if (total.kind !== v.kind || (v.scope !== 'execute' && v.scope !== 'engine') || tags.phase === 'prepare') return invalid();
  return {metric, kind: total.kind, tags, total, scope: v.scope};
}
