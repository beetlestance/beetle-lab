import type { EngineCatalogue, InstallationStatus } from '@beetle/contracts/api';

const measured = (value: number) => ({ status: 'measured' as const, value });
const unmeasured = { status: 'not_measured' as const, value: null };

export function installationStatus(
  state: InstallationStatus['agent']['state'] = 'ready',
  overrides: Partial<InstallationStatus> = {},
): InstallationStatus {
  return {
    scope: { kind: 'installation' },
    generatedAt: '2026-11-18T10:00:00.000Z',
    agent: { state, lastSeenAt: '2026-11-18T09:58:00.000Z', checkedAt: '2026-11-18T10:00:00.000Z' },
    host: {
      source: 'docker-daemon',
      cpuCores: measured(10),
      memoryTotalBytes: measured(32_000_000_000),
      cpuUsedMillis: unmeasured,
      memoryAvailableBytes: unmeasured,
    },
    disk: {
      backendFreeBytes: measured(412_000_000_000),
      backendTotalBytes: measured(1_000_000_000_000),
      stagingFreeBytes: unmeasured,
      freeSpaceReserveBytes: 0,
      storageAllocationBytes: 10_000,
      storageChargedBytes: 4_000,
    },
    engines: [{ profileId: 'k6', imageDigest: `sha256:${'b'.repeat(64)}`, image: 'verified_at_agent_start' }],
    pool: {
      slots: { used: 1, runs: 1, exports: 0, configured: 2, effective: 2 },
      reservedCpuMillis: 1000,
      reservedMemoryBytes: 1024,
      poolCpuMillis: 2000,
      poolMemoryBytes: 4096,
      queuedRuns: 0,
      queuedExports: 0,
    },
    ...overrides,
  };
}

export function engineCatalogue(status: InstallationStatus = installationStatus()): EngineCatalogue {
  return {
    scope: { kind: 'installation' },
    generatedAt: status.generatedAt,
    engines: [
      { id: 'k6', availability: 'installed', state: 'ready', profiles: status.engines },
      ...(['unit-tests', 'integration-tests', 'lint', 'formatting', 'mutation-testing'] as const).map((id) => ({
        id,
        availability: 'planned' as const,
        state: 'planned' as const,
        profiles: [],
      })),
    ],
  };
}
