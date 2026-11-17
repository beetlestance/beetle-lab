import { LIVE_TARGET_SAMPLES, liveTargetLookbackMs } from '@beetle/contracts/api';
import type { LiveTargetReadings, LiveTargetValues } from '@beetle/contracts/api';
import type { TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import type { LiveTargetSource } from './types.js';

const names = [
  'rss',
  'heapAlloc',
  'heapInuse',
  'usedHeapSize',
  'totalHeapSize',
  'cpuPercent',
  'systemCpuPercent',
  'eventLoopDelay.mean',
  'eventLoopDelay.p99',
  'eventLoopDelay.max',
  'activeHandles',
  'goroutines',
] as const satisfies readonly (keyof LiveTargetValues)[];

function values(sample: TargetRuntimeSample): LiveTargetValues {
  const source = sample.values as Readonly<Record<string, number | null | undefined>>;
  const entries = names.map((name) => {
    const value = sample.status === 'ready' ? source[name] : null;
    return [name, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
  });
  return Object.fromEntries(entries) as LiveTargetValues;
}

/**
 * Newest before/during samples inside the frame lookback, oldest first. Samples outside it,
 * after publication time, out of order or unparsable are counted in omittedSamples, never repaired.
 */
export function liveTargetReadings(source: LiveTargetSource, publishedAtMs: number): LiveTargetReadings {
  const oldest = publishedAtMs - liveTargetLookbackMs(source.intervalMs);
  const recent = source.recent(LIVE_TARGET_SAMPLES);
  const samples: LiveTargetReadings['samples'] = [];
  for (const sample of recent) {
    const observedAtMs = Date.parse(sample.observedAt);
    const previous = samples.at(-1)?.observedAtMs ?? -1;
    if (
      sample.phase === 'after' ||
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs > publishedAtMs ||
      observedAtMs < oldest ||
      observedAtMs <= previous
    )
      continue;
    samples.push({ observedAtMs, phase: sample.phase, status: sample.status, values: values(sample) });
  }
  return {
    scope: 'target-reported',
    intervalMs: source.intervalMs,
    samples,
    omittedSamples: recent.length - samples.length,
  };
}
