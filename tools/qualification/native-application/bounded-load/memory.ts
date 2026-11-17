import assert from 'node:assert/strict';
import { record } from '../../resources/values.js';
import { array, bounded, count, terminal } from '../conformance/values.js';
import { publicRssFacts } from '../rss/public.js';
const roles = ['backend', 'agent'];
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function tail(input: unknown) {
  const trial = record(input);
  publicRssFacts(trial);
  const points = (trial.rssPoints as unknown[]).map(record).filter((row) => row.phase === 'post-idle');
  const end = bounded(points.at(-1)?.at, 120000);
  const start = bounded(points[0]?.at, 120000);
  assert(end - start >= 30000, 'Need the fixed32-second post-idle observation');
  const last = points.filter((row) => bounded(row.at, 120000) >= end - 8000);
  assert(last.length >= 4);
  assert(end - bounded(last[0]?.at, 120000) >= 5000, 'Insufficient final-window coverage');
  return roles.map((role) => ({
    role,
    medianRssBytes: median(
      last.map((point) => {
        const peer = (point.peers as unknown[]).map(record).find((row) => row.role === role);
        assert(peer);
        return count(peer.summedRssBytes, 268435456);
      }),
    ),
    samples: last.length,
  }));
}
/** Fixed finite acceptance, not a general leak-free guarantee. Failure retains measurements. */
export function memoryFacts(input: unknown) {
  const rows = array(input, 4).map((value, index) => {
    const trial = record(value);
    assert.equal(trial.index, index);
    assert.equal(trial.warmup, index === 0);
    const loaded = record(trial.loaded);
    terminal(loaded.run, 'passed');
    const p95Ms = bounded(loaded.apiP95Ms, 120000);
    const endpoints = array(loaded.endpoints, 2).map(record);
    assert.deepEqual(endpoints.map((row) => row.endpoint).sort(), ['live', 'run']);
    const live = endpoints.filter((row) => row.endpoint === 'live');
    assert.equal(live.length, 1);
    assert(count(live[0]!.attempted, 512) > 0);
    const liveP95Ms = bounded(live[0]!.p95Ms, 120000);
    const readers = array(loaded.readers, 3);
    for (const value of readers) assert(count(record(value).frames, 128) >= 2);
    assert.equal(array(trial.postIdleWindows, 4).length, 4);
    return { index, p95Ms, liveP95Ms, tail: tail(trial) };
  });
  const growth = roles.map((role) => {
    const first = rows[0]!.tail.find((row) => row.role === role)!;
    const last = rows[3]!.tail.find((row) => row.role === role)!;
    return {
      role,
      warmupMedianRssBytes: first.medianRssBytes,
      finalMedianRssBytes: last.medianRssBytes,
      growthBytes: last.medianRssBytes - first.medianRssBytes,
    };
  });
  return {
    scope: 'four-finite-runs-final-eight-second-median',
    postIdleSeconds: 32,
    p95LimitMs: 250,
    growthLimitBytes: 0,
    met: rows.every((row) => row.p95Ms <= 250 && row.liveP95Ms <= 250) && growth.every((row) => row.growthBytes <= 0),
    trials: rows,
    growth,
  };
}
