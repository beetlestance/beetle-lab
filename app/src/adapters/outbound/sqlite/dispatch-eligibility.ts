import type { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { DispatchBlockReason, DispatchEligibility } from '../../../ports/dispatch.js';
import { storageFits } from '../../../domain/settings/index.js';
import type { RunConfiguration } from '../../../ports/runs.js';
import type { Settings } from './settings.js';
import { executionRegistryDigest } from './execution-intents.js';
import { hasUntrackedOwnership } from './execution-ownership.js';
import { chargedFacts, retainedClaim } from './dispatch-candidates.js';
import type { DispatchFact } from './dispatch-candidates.js';
import { StorageError } from './protocol.js';

type Capacity = ReturnType<Settings['capacity']>;
const costs = ['cpu_millis', 'memory_bytes', 'pids', 'output_bytes', 'staging_bytes'] as const;
const budgetNames = { cpu_millis: 'cpuMillis', memory_bytes: 'memoryBytes', pids: 'pids',
  output_bytes: 'outputBytes', timeout_ms: 'timeoutMs' } as const;
export function blocked(reason: DispatchBlockReason): DispatchEligibility { return { kind: 'blocked', reason }; }
function safe(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError('unavailable');
  return value;
}
function checkedCosts(row: DispatchFact): void {
  for (const key of [...costs, 'timeout_ms'] as const) if (safe(row[key]) === 0) throw new StorageError('unavailable');
  safe(row.output_bytes + 65536);
  if (!['parallel', 'isolated'].includes(row.mode)) throw new StorageError('unavailable');
}
/** Single policy owner for both advisory discovery and immediate authorization. */
export class DispatchEligibilityOwner {
  readonly capacity: Capacity;
  readonly storage: { allocationBytes: number; reserveBytes: number } | null;
  private readonly usage: number;
  private readonly active: DispatchFact[];
  private readonly totals = { cpu_millis: 0, memory_bytes: 0, pids: 0, output_bytes: 0, staging_bytes: 0 };
  private readonly unknown: boolean;
  private readonly registry: Map<string, string>;
  constructor(db: DatabaseSync, settings: Settings, config: RunConfiguration) {
    this.capacity = settings.capacity();
    const values = this.capacity.installation.values;
    if (!validateApi('InstallationValues', values).ok) throw new StorageError('unavailable');
    const runtime = this.capacity.runtime;
    this.storage = runtime === null ? null : {
      allocationBytes: Math.min(values.pool.storageBytes, runtime.ceilings.pool.storageBytes),
      reserveBytes: Math.max(values.pool.freeSpaceReserveBytes, runtime.ceilings.pool.freeSpaceReserveBytes) };
    const usage = db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
    if (typeof usage !== 'number') throw new StorageError('unavailable');
    this.usage = safe(usage);
    this.unknown = hasUntrackedOwnership(db);
    this.registry = new Map(config.profiles.map(pin => [pin.engine.profileId, executionRegistryDigest(pin)]));
    this.active = chargedFacts(db);
    for (const row of this.active) {
      retainedClaim(row); checkedCosts(row);
      for (const key of costs) this.totals[key] = safe(this.totals[key] + row[key]);
    }
  }
  individual(row: DispatchFact): DispatchEligibility {
    const runtime = this.capacity.runtime;
    if (runtime === null) return blocked('capacity_unknown');
    checkedCosts(row);
    const user = this.capacity.installation.values;
    if (!this.profileAvailable(row)) return blocked('profile_unavailable');
    for (const key of Object.keys(budgetNames) as (keyof typeof budgetNames)[]) {
      const name = budgetNames[key];
      if (row[key] > Math.min(user.perRunCeilings[name], runtime.ceilings.perRun[name])) return blocked('per_run_ceiling');
    }
    if (costs.slice(0, 4).some(key => row[key] > this.pool(key))) return blocked('budget_unavailable');
    if (row.staging_bytes > Math.min(runtime.execution.stagingBytes, runtime.execution.perRunStagingBytes)) return blocked('staging_unavailable');
    if (this.storage === null || !storageFits({ chargedBytes: this.usage, requestedBytes: row.output_bytes + 65536,
      ...this.storage })) return blocked('storage_unavailable');
    return { kind: 'ready' };
  }
  private profileAvailable(row: DispatchFact): boolean {
    return this.registry.get(row.profile_alias) === row.registry_digest
      && this.capacity.installation.values.supportedProfiles.includes(row.profile_alias)
      && this.capacity.runtime!.ceilings.supportedProfiles.includes(row.profile_alias);
  }
  private pool(key: typeof costs[number]): number {
    const runtime = this.capacity.runtime;
    if (runtime === null) throw new StorageError('unavailable');
    if (key === 'staging_bytes') return safe(runtime.execution.stagingBytes);
    const name = budgetNames[key];
    return safe(Math.min(this.capacity.installation.values.pool[name], runtime.ceilings.pool[name]));
  }
  barrier(rows: readonly DispatchFact[]): number | null {
    let oldest: number | null = null;
    for (const row of rows) {
      if (this.fresh(row) !== null || row.mode !== 'isolated') continue;
      if (this.individual(row).kind === 'ready' && (oldest === null || row.queue_order! < oldest)) oldest = row.queue_order;
    }
    return oldest;
  }
  private fresh(row: DispatchFact): DispatchBlockReason | null {
    if (row.queue_order === null || row.attempt_marker === null) return 'untracked_intent';
    if (!this.queued(row)) return 'not_queued';
    if (row.foundation_owned !== 1 || row.attempt_marker !== row.attempt_id || row.outbox_marker !== row.attempt_id)
      throw new StorageError('unavailable');
    return null;
  }
  private queued(row: DispatchFact): boolean {
    return row.current_attempt === 1 && row.state === 'queued' && row.cancellation_requested === 0
      && row.generation === null && row.possible_delivery === 0 && row.record_id === null;
  }
  evaluate(row: DispatchFact, predecessor: number | null): DispatchEligibility {
    const reason = this.fresh(row);
    if (reason !== null) return blocked(reason);
    if (this.unknown) return blocked('ownership_unknown');
    const individual = this.individual(row);
    if (individual.kind === 'blocked') return individual;
    if (this.active.some(active => active.mode === 'isolated') || (row.mode === 'isolated' && this.active.length > 0)) return blocked('isolated');
    if (row.mode === 'parallel' && predecessor !== null && row.queue_order! > predecessor) return blocked('isolated_predecessor');
    return this.remaining(row);
  }
  private remaining(row: DispatchFact): DispatchEligibility {
    const runtime = this.capacity.runtime;
    if (runtime === null) return blocked('capacity_unknown');
    const concurrency = Math.min(this.capacity.installation.values.pool.concurrency, runtime.ceilings.pool.concurrency);
    if (this.active.length >= Math.min(64, safe(concurrency))) return blocked('budget_unavailable');
    for (const key of costs) {
      if (row[key] > this.pool(key) - this.totals[key]) return blocked(key === 'staging_bytes' ? 'staging_unavailable' : 'budget_unavailable');
    }
    return { kind: 'ready' };
  }
}
