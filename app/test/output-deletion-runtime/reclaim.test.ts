import { afterEach, expect, it, vi } from 'vitest';
import type {
  OutputDeletionMetadata,
  OutputDeletionPage,
  OutputDeletionSummary,
  RetiredReclaimQuery,
} from '../../src/ports/output-deletion-metadata.js';
import type { OutputSettlementMetadata } from '../../src/ports/output-settlement-metadata.js';
import type { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { startOutputDeletionRuntime } from '../../src/application/output-deletion-runtime/index.js';
import { RECLAIM_IDLE_MS } from '../../src/application/output-deletion-runtime/reclaims.js';
import { retirementFixture } from './retirement-fixture.js';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { uuid } from '../storage/fixture.js';
import { hash } from '../output-deletion/cleanup-ack/fixture.js';
import { retireWorkspace, usage } from '../retired-reclaim/fixture.js';
afterEach(() => vi.useRealTimers());
type Ports = Pick<
  OutputDeletionMetadata,
  | 'scanRetirements'
  | 'scanSettlements'
  | 'reserveControl'
  | 'retirementRequest'
  | 'recordCleanupAck'
  | 'cleanupAck'
  | 'reclaimRetired'
>;
function ports(store: Store) {
  const call = <T>(operation: Parameters<Store['execute']>[0]) => Promise.resolve(store.execute(operation) as T);
  const metadata: Ports = {
    scanRetirements: (query) => call({ kind: 'scanOutputRetirements', query }),
    scanSettlements: (query) => call({ kind: 'scanOutputSettlements', query }),
    reserveControl: (key) => call<OutputDeletionSummary>({ kind: 'reserveOutputCleanupControl', key }),
    retirementRequest: (key) => call({ kind: 'getOutputRetirementRequest', key }),
    recordCleanupAck: (request) => call({ kind: 'recordOutputCleanupAck', request }),
    cleanupAck: (key) => call({ kind: 'getOutputCleanupAck', key }),
    reclaimRetired: vi.fn((query: RetiredReclaimQuery) =>
      call<OutputDeletionPage>({ kind: 'reclaimRetiredOutputs', query }),
    ),
  };
  const settlements: OutputSettlementMetadata = {
    settle: (request) => call({ kind: 'settleBackendOutput', request }),
    read: (key) => call({ kind: 'readBackendSettlement', key }),
  };
  return { metadata, settlements };
}
it('creates intents for a retired workspace and lets the settlement lane free them; then idles', async () => {
  const f = retirementFixture();
  vi.useRealTimers();
  const source = claimsFixture();
  try {
    const runs = [70, 71].map((id) => source.add(id).runId);
    for (const id of runs) source.store.execute({ kind: 'cancelRun', command: cancelCommand(id) });
    retireWorkspace(source.store, uuid(1), uuid(2));
    const before = usage(source.db);
    const p = ports(source.store);
    const settleOutput = vi.fn(async (): Promise<never> => {
      throw Error('Unsent original dispatched');
    });
    f.metadata.scan.mockResolvedValue({ items: [], nextCursor: null });
    vi.useFakeTimers();
    const runtime = startOutputDeletionRuntime({
      ...f.options,
      metadata: f.metadata,
      retirement: { metadata: p.metadata, gateway: f.gateway, digest: hash },
      settlement: { metadata: p.metadata, store: p.settlements, gateway: { settleOutput }, digest: hash },
      reclaim: { metadata: p.metadata, clock: () => Date.now() },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(source.db.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(0);
    expect(source.db.prepare('SELECT count(*) n FROM backend_retired_runs').get()?.n).toBe(2);
    expect(usage(source.db)).toBeLessThan(before);
    expect(f.gateway.retireOutput).not.toHaveBeenCalled();
    expect(settleOutput).not.toHaveBeenCalled();
    expect(f.onFailure).not.toHaveBeenCalled();
    const calls = vi.mocked(p.metadata.reclaimRetired).mock.calls.length;
    await vi.advanceTimersByTimeAsync(RECLAIM_IDLE_MS / 2);
    expect(vi.mocked(p.metadata.reclaimRetired).mock.calls.length).toBe(calls);
    for (const [query] of vi.mocked(p.metadata.reclaimRetired).mock.calls) expect(query.limit).toBe(32);
    await runtime.close();
  } finally {
    vi.useRealTimers();
    source.db.close();
  }
});
it('refuses reclamation without the settlement lane', () => {
  const f = retirementFixture();
  const source = claimsFixture();
  try {
    const p = ports(source.store);
    expect(() =>
      startOutputDeletionRuntime({
        ...f.options,
        metadata: f.metadata,
        retirement: { metadata: p.metadata, gateway: f.gateway, digest: hash },
        reclaim: { metadata: p.metadata, clock: () => 0 },
      }),
    ).toThrow('Reclamation requires settlement');
  } finally {
    source.db.close();
  }
});
