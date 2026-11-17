import { expect, it } from 'vitest';
import {
  AGENT_STALE_AFTER_MS,
  AgentStatusBoard,
  getInstallationStatus,
  getRunQueue,
} from '../../src/application/installation-status/index.js';
import type { AgentFacts, InstallationStatusReader, PoolUsageFacts } from '../../src/ports/installation-status.js';

const digest = `sha256:${'a'.repeat(64)}`;
const missing = `sha256:${'b'.repeat(64)}`;
const pins = [
  { profileId: 'standard', imageDigest: digest },
  { profileId: 'heavy', imageDigest: missing },
];
const runId = '00000000-0000-4000-8000-000000000070';
const scope = {
  kind: 'workspace' as const,
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
};
const usage: PoolUsageFacts = {
  pool: {
    slots: { used: 1, runs: 1, exports: 0, configured: 4, effective: 2 },
    reservedCpuMillis: 500,
    reservedMemoryBytes: 1024,
    poolCpuMillis: 4000,
    poolMemoryBytes: 8192,
    queuedRuns: 2,
    queuedExports: 0,
  },
  storage: { chargedBytes: 10, allocationBytes: 1000, reserveBytes: 100 },
};
const reader: InstallationStatusReader = {
  poolUsage: () => Promise.resolve(usage),
  runQueue: () =>
    Promise.resolve({
      runId,
      state: 'queued',
      waiting: 'backend_queue',
      position: 2,
      slots: usage.pool.slots,
      holders: [],
      otherWorkspaceRuns: 1,
    }),
};
function facts(observedAtMs: number, daemon: AgentFacts['daemon'] = { cpuMillis: 8500, memoryBytes: 16384 }): AgentFacts {
  return {
    observedAtMs,
    daemon,
    stagingFreeBytes: 5000,
    backendDisk: { totalBytes: 9000, availableBytes: 7000 },
    imageDigests: [digest],
  };
}
const status = (board: AgentStatusBoard | null, nowMs: number) =>
  getInstallationStatus({ reader, agent: board?.snapshot() ?? null, nowMs });

it('reports disabled without an agent runtime and unknown before the first sample, never fabricating host facts', async () => {
  const disabled = await status(null, 1000);
  expect(disabled.agent).toEqual({ state: 'disabled', lastSeenAt: null, checkedAt: null });
  expect(disabled.engines).toEqual([]);
  expect(disabled.pool).toEqual(usage.pool);
  const unknown = await status(new AgentStatusBoard(pins), 1000);
  expect(unknown.agent.state).toBe('unknown');
  expect(unknown.host.cpuCores).toEqual({ status: 'unknown', value: null });
  expect(unknown.disk.backendFreeBytes).toEqual({ status: 'unknown', value: null });
  expect(unknown.disk).toMatchObject({ freeSpaceReserveBytes: 100, storageAllocationBytes: 1000, storageChargedBytes: 10 });
  expect(unknown.engines.map((engine) => engine.image)).toEqual(['unknown', 'unknown']);
});

it('reports ready measured facts with per-field provenance and image presence from the pinned digests', async () => {
  const board = new AgentStatusBoard(pins);
  board.record({ kind: 'ready', checkedAtMs: 1000, facts: facts(1000) });
  const ready = await status(board, 1500);
  expect(ready.agent).toEqual({
    state: 'ready',
    lastSeenAt: new Date(1000).toISOString(),
    checkedAt: new Date(1000).toISOString(),
  });
  expect(ready.host).toEqual({
    source: 'docker-daemon',
    cpuCores: { status: 'measured', value: 8 },
    memoryTotalBytes: { status: 'measured', value: 16384 },
    cpuUsedMillis: { status: 'not_measured', value: null },
    memoryAvailableBytes: { status: 'not_measured', value: null },
  });
  expect(ready.disk.stagingFreeBytes).toEqual({ status: 'measured', value: 5000 });
  expect(ready.engines.map((engine) => engine.image)).toEqual(['verified_at_agent_start', 'unknown']);
  board.record({ kind: 'ready', checkedAtMs: 2000, facts: facts(2000, null) });
  const synthetic = await status(board, 2000);
  expect(synthetic.host.cpuCores).toEqual({ status: 'not_measured', value: null });
});

it('reports unreachable and unavailable failures while keeping the last-seen timestamp but no stale facts', async () => {
  const board = new AgentStatusBoard(pins);
  board.record({ kind: 'ready', checkedAtMs: 1000, facts: facts(1000) });
  for (const kind of ['unreachable', 'unavailable'] as const) {
    board.record({ kind, checkedAtMs: 1200 });
    const failed = await status(board, 1300);
    expect(failed.agent).toEqual({
      state: kind,
      lastSeenAt: new Date(1000).toISOString(),
      checkedAt: new Date(1200).toISOString(),
    });
    expect(failed.host.memoryTotalBytes).toEqual({ status: 'unknown', value: null });
    expect(failed.disk.backendTotalBytes).toEqual({ status: 'unknown', value: null });
    expect(failed.engines.map((engine) => engine.image)).toEqual(['unknown', 'unknown']);
  }
});

it('reports stale samples after the freshness window or from the future and ignores clock rollback', async () => {
  const board = new AgentStatusBoard(pins);
  board.record({ kind: 'ready', checkedAtMs: 1000, facts: facts(1000) });
  expect((await status(board, 1000 + AGENT_STALE_AFTER_MS)).agent.state).toBe('ready');
  const stale = await status(board, 1001 + AGENT_STALE_AFTER_MS);
  expect(stale.agent.state).toBe('stale');
  expect(stale.host.cpuCores).toEqual({ status: 'unknown', value: null });
  expect((await status(board, 999)).agent.state).toBe('stale');
  board.record({ kind: 'unreachable', checkedAtMs: 500 });
  expect(board.snapshot().last?.kind).toBe('ready');
});

it('returns the scoped queue view and refuses a mismatched run identity', async () => {
  const queue = await getRunQueue({ scope, id: runId.toUpperCase() }, reader, 0);
  expect(queue).toMatchObject({ runId, position: 2, otherWorkspaceRuns: 1, generatedAt: new Date(0).toISOString() });
  await expect(getRunQueue({ scope, id: '00000000-0000-4000-8000-000000000071' }, reader, 0)).rejects.toThrow();
});
