import { afterEach, beforeEach, expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { uuid } from './fixture.js';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import type { PoolUsageFacts, RunQueueFacts } from '../../src/ports/installation-status.js';
import {
  checkStatusOperation,
  readInstallationStatus,
} from '../../src/adapters/outbound/sqlite/installation-status/index.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { markHistorical, assertHistoricalRead } from '../../src/adapters/outbound/sqlite/historical.js';

let f: ClaimsFixture;
beforeEach(() => {
  f = claimsFixture();
});
afterEach(() => f.db.close());

const own = { kind: 'workspace' as const, organizationId: uuid(1), workspaceId: uuid(2) };
function pool(): PoolUsageFacts {
  return readInstallationStatus(f.db, f.settings, reads(), { kind: 'getPoolUsage' }) as PoolUsageFacts;
}
function queue(key: DispatchKey, scope = own): RunQueueFacts {
  return readInstallationStatus(f.db, f.settings, reads(), {
    kind: 'getRunQueue',
    key: { scope, id: key.runId },
  }) as RunQueueFacts;
}
function reads(): RunReads {
  return new RunReads(f.db, new Suites(f.db, new Entities(f.db)));
}

it('reports an idle pool from the dispatch accounting without inventing pool totals', () => {
  const facts = pool();
  expect(facts.pool.slots).toMatchObject({ used: 0, runs: 0, exports: 0 });
  expect(facts.pool).toMatchObject({ reservedCpuMillis: 0, reservedMemoryBytes: 0, queuedRuns: 0, queuedExports: 0 });
  expect(facts.pool.slots.effective).toBe(Math.min(64, facts.pool.slots.configured, f.runtime.ceilings.pool.concurrency));
  expect(validateApi('PoolUsage', facts.pool).ok).toBe(true);
});

it('orders queued runs, names same-workspace slot holders and only counts other workspaces', () => {
  const first = f.add(70);
  const other = f.addOther();
  const second = f.add(71);
  const third = f.add(73);
  expect(queue(third)).toMatchObject({ waiting: 'backend_queue', position: 4, holders: [], otherWorkspaceRuns: 0 });
  expect(f.claims.claim(first).kind).toBe('claimed');
  expect(f.claims.claim(other).kind).toBe('claimed');
  const facts = queue(third);
  expect(facts).toMatchObject({ runId: third.runId, state: 'queued', waiting: 'backend_queue', position: 2 });
  expect(facts.holders).toEqual([{ runId: first.runId, suiteId: expect.any(String), suiteName: 'Synthetic' }]);
  expect(facts.otherWorkspaceRuns).toBe(1);
  expect(facts.slots).toMatchObject({ used: 2, runs: 2, exports: 0 });
  expect(JSON.stringify(facts)).not.toContain(other.runId);
  expect(queue(second).position).toBe(1);
  expect(queue(first)).toMatchObject({ waiting: 'agent_admission', position: null });
  const usage = pool().pool;
  expect(usage.queuedRuns).toBe(2);
  expect(usage.reservedCpuMillis).toBeGreaterThan(0);
  expect(validateApi('RunQueueStatus', { scope: own, generatedAt: new Date(0).toISOString(), ...facts }).ok).toBe(true);
});

it('reports an isolated charge without naming a holder in another workspace', () => {
  const holder = f.add(70, 'isolated');
  const waiting = f.addOther();
  expect(f.claims.claim(holder).kind).toBe('claimed');
  const scope = { kind: 'workspace' as const, organizationId: uuid(21), workspaceId: uuid(22) };
  const facts = readInstallationStatus(f.db, f.settings, reads(), {
    kind: 'getRunQueue',
    key: { scope, id: waiting.runId },
  }, (run) => f.claims.capacityReason(run));
  expect(facts).toMatchObject({ capacityBlockReason: 'isolated', holders: [], otherWorkspaceRuns: 1 });
  expect(validateApi('RunQueueStatus', { scope, generatedAt: new Date(0).toISOString(), ...facts }).ok).toBe(true);
  expect(JSON.stringify(facts)).not.toContain(holder.runId);
});

it('stops waiting once cancellation is requested and denies cross-workspace queue reads', () => {
  const key = f.add(70);
  f.db.prepare('UPDATE runs SET cancellation_requested=1 WHERE id=?').run(key.runId);
  expect(queue(key)).toMatchObject({ waiting: 'not_waiting', position: null });
  const foreign = { kind: 'workspace' as const, organizationId: uuid(21), workspaceId: uuid(22) };
  expect(() => queue(key, foreign)).toThrow();
});

it('accepts only the worker messageId envelope beside the closed status operation fields', () => {
  const key = { scope: own, id: uuid(70) };
  expect(() => checkStatusOperation({ kind: 'getPoolUsage', messageId: 7 } as never)).not.toThrow();
  expect(() => checkStatusOperation({ kind: 'getRunQueue', key, messageId: 8 } as never)).not.toThrow();
  for (const messageId of [0, -1, 1.5, '7', null]) {
    expect(() => checkStatusOperation({ kind: 'getPoolUsage', messageId } as never)).toThrow();
  }
  expect(() => checkStatusOperation({ kind: 'getRunQueue', key, extra: 1 } as never)).toThrow();
});

it('refuses malformed status operations and allows the reads in historical mode', () => {
  expect(() => checkStatusOperation({ kind: 'getRunQueue', key: { scope: own, id: 'nope' } } as never)).toThrow();
  expect(() => checkStatusOperation({ kind: 'getPoolUsage', extra: 1 } as never)).toThrow();
  markHistorical(f.db);
  expect(() => assertHistoricalRead(f.db, { kind: 'getPoolUsage' })).not.toThrow();
  expect(pool().pool.slots.used).toBe(0);
});
