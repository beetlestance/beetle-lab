import {expect, it} from 'vitest';
import {captureTargetRuntimeReport, targetMetricNames} from '@beetle/contracts/target-runtime';
import {qualifyReport} from './evidence.js';
import {configuration} from './config.js';
function fixture() {
 const values = Object.fromEntries(targetMetricNames.map(name => [name, null as number | null]));
 Object.assign(values, {heapAlloc: 0, rss: 123456, 'cppHeap.allocated_size': 42, 'cppHeap.used_size': 0,
 'eventLoopDelay.mean': 0, 'eventLoopDelay.p90': 2, 'eventLoopDelay.p99': 3, 'eventLoopDelay.max': 4, 'gc.count': 7, 'gc.duration': 12.5});
 const rows = [['before', 'ready', null], ['during', 'unavailable', 'invalid_json'], ['during', 'unavailable', 'http'], ['during', 'ready', null], ['after', 'ready', null]] as const;
 return {format: 'beetle-target-runtime', version: 1, scope: 'target-reported', limited: false, missed: 2,
 samples: rows.map(([phase, status, reason], i) => ({phase, status, reason, observedAt: new Date(1700000000000 + i * 1000).toISOString(),
 values: status === 'ready' ? {...values} : Object.fromEntries(targetMetricNames.map(name => [name, null as number | null]))}))};
}
it('preserves genuine zero, target units, null unsupported values and advisory misses', () => {
 const result = qualifyReport(captureTargetRuntimeReport(fixture())); expect(result.readyValues.heapAlloc).toBe(0); expect(result.readyValues.external).toBeNull();
 expect(configuration().targetSampling!.cooldownMs).toBe(3000);
});
it('rejects altered known metrics and loss of a complete observation phase', () => {
 const wrong = fixture(); wrong.samples[0]!.values.rss = 1; expect(() => qualifyReport(captureTargetRuntimeReport(wrong))).toThrow();
 const missing = fixture(); missing.samples.pop(); expect(() => qualifyReport(captureTargetRuntimeReport(missing))).toThrow();
});
