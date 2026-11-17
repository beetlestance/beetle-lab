import { modes } from './config.js';
import { comparison } from './compare.js';
import type { Point } from './observe.js';
export function fixture() {
  const installationId = '11111111-1111-4111-8111-111111111111';
  const revision = 'a'.repeat(40);
  const kinds = [
    'metric-windows',
    'metric-index',
    'k6-warnings',
    'k6-diagnostics',
    'native-summary',
    'numeric-final',
    'performance-report',
    'metrics-csv',
  ];
  const results = fixtureResults(kinds);
  const component = {
    status: 'passed',
    orderlyDrained: true,
    agentPid: 1,
    agentUid: 1000,
    installationId,
    results,
    secret: 'NEVER-PUBLIC',
  };
  const points: Point[] = modes.flatMap((mode, index) =>
    [0, 1].map((n) => ({
      index,
      mode,
      at: index * 2000 + n * 1000,
      cpuNanos: index * 10000000 + n * 1000000,
      memoryBytes: 100000000,
      anonymousBytes: 90000000,
      processes: 1,
      summedRssBytes: 110000000,
      largestProcessRssBytes: 110000000,
    })),
  );
  const baseImageIds = Object.fromEntries(
    ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'].map((role, n) => [
      role,
      'sha256:' + String(n + 1).repeat(64),
    ]),
  );
  const input = {
    harnessNode: 'v24.22.3',
    status: 'passed',
    phase: 'evidence',
    cleanupVerified: true,
    sourceRevision: revision,
    architecture: 'arm64',
    baseImageIds,
    privatePath: '/Users/private',
    results: {
      nativeOriginals: [{ status: 'fulfilled' }, { status: 'fulfilled' }],
      points,
      comparison: comparison(component, points),
      target: { ready: 10, work: 40000, unexpected: 0 },
      targetSourceSha256: 'd'.repeat(64),
      overlay: {
        id: 'sha256:' + 'a'.repeat(64),
        baseImageId: baseImageIds.agent,
        bundle: { bytes: 1024, sha256: 'c'.repeat(64) },
      },
      flags: [
        { mode: 'off', processOne: { present: false, value: null } },
        { mode: 'on', processOne: { present: true, value: '1' } },
      ],
    },
  };
  return { input, component, expected: { revision, architecture: 'arm64', installationId } };
}

function fixtureResults(kinds: readonly string[]) {
  return modes.map((mode, index) => {
    const id = 'e'.repeat(63) + String(index);
    return {
      index,
      mode,
      warmup: index < 2,
      wallMs: mode === 'on' ? 10400 : 10000,
      runtimeId: id,
      budget: { cpuMillis: 1000, memoryBytes: 536870912, pids: 128, timeoutMs: 60000, outputBytes: 8388608 },
      subscribers: Array.from({ length: 3 }, () =>
        mode === 'on' ? { calls: 4, frames: 2, unavailable: 2 } : { calls: 0, frames: 0, unavailable: 0 },
      ),
      removed: {
        containerId: id,
        liveVolume: 'beetle-' + id + '-live',
        fixtureCleanup: true,
        storageRefund: false,
        force: false,
      },
      final: {
        outcome: 'passed',
        completeness: 'complete',
        assertions: { required: 4, passed: 4, failed: 0, unknown: 0 },
        verifiedArtifactBytes: 8,
        commonArtifactCeilingBytes: 524288,
        numeric: {
          requestCount: 4000,
          durationCount: 4000,
          series: 25,
          identities: 25,
          totalsComplete: true,
          quantiles: 'histogram-estimate',
        },
        artifacts: kinds.map((kind, n) => ({ kind, bytes: 1, sha256: String(n).repeat(64) })),
      },
    };
  });
}
