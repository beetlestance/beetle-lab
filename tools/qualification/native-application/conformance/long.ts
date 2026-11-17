import assert from 'node:assert/strict';
import { record } from '../../resources/values.js';
import { array, bounded, count, terminal } from './values.js';
function peers(input: unknown) {
  const seen = new Set<string>();
  return array(input, 3).map((value) => {
    const row = record(value);
    assert(typeof row.role === 'string' && ['frontend', 'backend', 'agent'].includes(row.role) && !seen.has(row.role));
    seen.add(row.role);
    const samples = count(row.samples, 128);
    assert(samples >= 2);
    const elapsedMs = bounded(row.elapsedMs, 2160000, Number.EPSILON);
    const first = record(row.first);
    const last = record(row.last);
    assert(
      Math.abs(bounded(last.at, Number.MAX_SAFE_INTEGER) - bounded(first.at, Number.MAX_SAFE_INTEGER) - elapsedMs) <
        0.001,
    );
    const delta = count(last.cpuNanos, Number.MAX_SAFE_INTEGER) - count(first.cpuNanos, Number.MAX_SAFE_INTEGER);
    assert(delta >= 0);
    const cpuOneCorePercent = bounded(row.cpuOneCorePercent, 10000);
    assert(Math.abs(cpuOneCorePercent - delta / (elapsedMs * 10000)) < 0.0001);
    const peakMemoryBytes = count(row.peakMemoryBytes, row.role === 'frontend' ? 67108864 : 268435456);
    assert(peakMemoryBytes > 0);
    return { role: row.role, samples, elapsedMs, peakMemoryBytes, cpuOneCorePercent };
  });
}
function artifacts(input: unknown) {
  const kinds = [
    'k6-diagnostics',
    'k6-warnings',
    'metric-index',
    'metric-windows',
    'metrics-csv',
    'native-summary',
    'numeric-final',
    'performance-report',
  ];
  const rows = array(input, 8).map((value) => {
    const row = record(value);
    assert(typeof row.kind === 'string' && kinds.includes(row.kind));
    assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
    return { kind: row.kind, bytes: count(row.bytes, 16777216), sha256: row.sha256 };
  });
  assert.equal(new Set(rows.map((row) => row.kind)).size, 8);
  return rows;
}
export function longFacts(input: unknown) {
  const rows = record(input);
  const stream = record(rows.stream);
  const final = record(rows.final);
  assert.deepEqual(rows.targetRequests, { ready: 1, work: 1830, unexpected: 0 });
  assert.equal(final.terminalLiveUnavailable, true);
  const readers = array(stream.readers, 3).map((value) => {
    const row = record(value);
    const first = bounded(row.firstFrameMs, 2160000);
    const last = bounded(row.lastFrameMs, 2160000);
    assert(count(row.frames, 1100) >= 2);
    const freshSpanMs = bounded(last - first, 2160000, 1740000);
    return {
      frames: count(row.frames, 1100),
      polls: count(row.polls, 1100),
      unavailable: count(row.unavailable, 1100),
      freshSpanMs,
      longestNewFrameGapMs: bounded(row.longestNewFrameGapMs, 2160000),
      tailWithoutNewFrameMs: bounded(row.tailWithoutNewFrameMs, 2160000),
    };
  });
  const latency = array(stream.latency, 2).map((value, index) => {
    const row = record(value);
    const endpoint = index ? 'live' : 'run';
    assert.equal(row.endpoint, endpoint);
    const attempted = count(row.attempted, 8192);
    const successful = count(row.successful, 8192);
    const unavailable = count(row.unavailable, 8192);
    assert(successful > 0 && attempted === successful + unavailable);
    return {
      endpoint,
      attempted,
      successful,
      unavailable,
      allP95Ms: bounded(row.allP95Ms, 120000),
      successfulP95Ms: bounded(row.successfulP95Ms, 120000),
    };
  });
  return {
    run: terminal(stream.run, 'passed'),
    activeMs: bounded(stream.activeMs, 1920000, 1800000),
    readers,
    latency,
    peers: peers(stream.peers),
    postIdlePeers: peers(record(rows.postIdle).peers),
    artifacts: artifacts(final.artifacts),
    targetRequests: { ready: 1, work: 1830, unexpected: 0 },
    terminalLiveUnavailable: true,
  };
}
