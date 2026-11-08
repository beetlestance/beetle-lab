import execution from 'k6/execution';
import { measureStartedMetric } from '../plan/index.js';
import type { CounterName } from '../plan/index.js';
import type { Counter } from 'k6/metrics';

export function nativeMetric(counter: Counter, name: CounterName, value: number, tags: Readonly<Record<string, string>>): void {
  if (name !== measureStartedMetric) { counter.add(value, tags); return; }
  const vuTags = execution.vu.metrics.tags;
  const previous = vuTags.phase;
  delete vuTags.phase;
  try { counter.add(value, tags); }
  finally { if (previous === undefined) delete vuTags.phase; else vuTags.phase = previous; }
}
export function nativePhase(phase: 'prepare' | 'execute'): void { execution.vu.metrics.tags.phase = phase; }
