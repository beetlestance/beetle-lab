import type { Run } from '@beetle/contracts/api';
import type { DatabaseSync } from 'node:sqlite';
import type { PoolUsageFacts, RunQueueFacts, UnfinishedWorkFacts } from '../../../../ports/installation-status.js';
import type { RunKey } from '../../../../ports/runs.js';
import type { Settings } from '../settings.js';
import type { RunReads } from '../run-reads.js';
import { normalizedScope } from '../suites.js';
import { lower } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { transaction } from '../transaction.js';
import type { StatusOperation } from './wire.js';
export { statusOperation, checkStatusOperation } from './wire.js';
export type { StatusOperation } from './wire.js';

/** Same bound the dispatch eligibility owner enforces for charged work. */
const MAX_CHARGED = 64;
const runPending = "r.state IN ('queued','dispatching','active','finalizing')";
const exportPending = "state IN ('queued','dispatching','generating','publishing','unknown')";
interface ChargedRun {
  runId: string;
  organizationId: string;
  workspaceId: string;
  suiteId: string;
  suiteName: string | null;
  cpu: number;
  memory: number;
}
const chargedRunsSql = `SELECT e.run_id AS runId,e.organization_id AS organizationId,e.workspace_id AS workspaceId,
 r.suite_id AS suiteId,s.name AS suiteName,i.cpu_millis AS cpu,i.memory_bytes AS memory
 FROM execution_records e INDEXED BY execution_charged
 JOIN execution_intents i ON i.attempt_id=e.attempt_id
 JOIN runs r ON r.id=e.run_id AND r.organization_id=e.organization_id AND r.workspace_id=e.workspace_id
 LEFT JOIN suites s ON s.id=r.suite_id AND s.organization_id=r.organization_id AND s.workspace_id=r.workspace_id
 WHERE e.execution_charged=1 ORDER BY e.queue_order LIMIT ${MAX_CHARGED + 1}`;
const chargedExportsSql = `SELECT cpu_millis AS cpu,memory_bytes AS memory FROM export_jobs INDEXED BY exports_charged
 WHERE execution_charged=1 LIMIT ${MAX_CHARGED + 1}`;
const queuedSql = `SELECT
 (SELECT count(*) FROM runs r INDEXED BY runs_pending WHERE ${runPending} AND r.state='queued') AS runs,
 (SELECT count(*) FROM export_jobs INDEXED BY exports_pending WHERE ${exportPending} AND state='queued') AS exports`;
const aheadSql = `SELECT
 (SELECT count(*) FROM runs r INDEXED BY runs_pending JOIN execution_intents i ON i.attempt_id=r.active_attempt_id
   WHERE ${runPending} AND r.state='queued' AND r.cancellation_requested=0 AND i.queue_order<?) +
 (SELECT count(*) FROM export_jobs INDEXED BY exports_pending
   WHERE ${exportPending} AND state='queued' AND cancellation_requested=0 AND queue_order<?) AS ahead`;

// Upgrade drain blockers: nonterminal runs and exports, unpublished uploads, removals still freeing files.
const unfinishedSql = `SELECT
 (SELECT count(*) FROM runs r INDEXED BY runs_pending WHERE ${runPending}) AS runs,
 (SELECT count(*) FROM export_jobs INDEXED BY exports_pending WHERE ${exportPending}) AS exports,
 (SELECT count(*) FROM input_blobs WHERE state IN ('staging','publishing','deleting')) AS uploads,
 (SELECT count(*) FROM output_deletion_intents WHERE pending_files>0) AS removals`;

function sum(rows: readonly { cpu: number; memory: number }[], key: 'cpu' | 'memory'): number {
  const total = rows.reduce((value, row) => value + row[key], 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new StorageError('unavailable');
  return total;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new StorageError('unavailable');
  return value;
}

/** Read-only snapshot of backend dispatch accounting; agent admission remains the final authority. */
class InstallationStatusReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly settings: Settings,
    private readonly runReads: RunReads,
    private readonly capacityReason:
      ((run: Run) => Exclude<RunQueueFacts['capacityBlockReason'], undefined>) | undefined,
  ) {}
  private charged(): { runs: ChargedRun[]; exports: { cpu: number; memory: number }[] } {
    const runs = this.db.prepare(chargedRunsSql).all() as unknown as ChargedRun[];
    const exports = this.db.prepare(chargedExportsSql).all() as unknown as { cpu: number; memory: number }[];
    if (runs.length + exports.length > MAX_CHARGED) throw new StorageError('unavailable');
    return { runs, exports };
  }
  pool(charged = this.charged()): PoolUsageFacts {
    const { installation, runtime } = this.settings.capacity();
    const values = installation.values.pool;
    const pool = runtime?.ceilings.pool;
    const queued = this.db.prepare(queuedSql).get() as { runs: unknown; exports: unknown };
    const all = [...charged.runs, ...charged.exports];
    const usage = this.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get();
    return {
      pool: {
        slots: {
          used: all.length,
          runs: charged.runs.length,
          exports: charged.exports.length,
          configured: values.concurrency,
          effective: pool ? Math.min(MAX_CHARGED, values.concurrency, pool.concurrency) : null,
        },
        reservedCpuMillis: sum(all, 'cpu'),
        reservedMemoryBytes: sum(all, 'memory'),
        poolCpuMillis: pool ? Math.min(values.cpuMillis, pool.cpuMillis) : null,
        poolMemoryBytes: pool ? Math.min(values.memoryBytes, pool.memoryBytes) : null,
        queuedRuns: count(queued.runs),
        queuedExports: count(queued.exports),
      },
      storage: {
        chargedBytes: count(usage?.charged_bytes),
        allocationBytes: values.storageBytes,
        reserveBytes: values.freeSpaceReserveBytes,
      },
    };
  }
  unfinished(): UnfinishedWorkFacts {
    const row = this.db.prepare(unfinishedSql).get() as Record<keyof UnfinishedWorkFacts, unknown>;
    return { runs: count(row.runs), exports: count(row.exports), uploads: count(row.uploads), removals: count(row.removals) };
  }
  queue(key: RunKey): RunQueueFacts {
    const run = this.runReads.get(key);
    const scope = normalizedScope(key.scope);
    const charged = this.charged();
    const own = (row: ChargedRun) =>
      row.organizationId === scope.organizationId && row.workspaceId === scope.workspaceId;
    const waiting =
      run.state === 'queued' && !run.cancellationRequested
        ? 'backend_queue'
        : run.state === 'dispatching'
          ? 'agent_admission'
          : 'not_waiting';
    return {
      runId: lower(run.id),
      state: run.state,
      waiting,
      ...(this.capacityReason
        ? { capacityBlockReason: waiting === 'backend_queue' ? this.capacityReason(run) : null }
        : {}),
      position: waiting === 'backend_queue' ? this.position(lower(run.id), scope) : null,
      slots: this.pool(charged).pool.slots,
      holders: charged.runs
        .filter(own)
        .map((row) => ({ runId: row.runId, suiteId: row.suiteId, suiteName: row.suiteName })),
      otherWorkspaceRuns: charged.runs.filter((row) => !own(row)).length,
    };
  }
  private position(runId: string, scope: { organizationId: string; workspaceId: string }): number | null {
    const row = this.db
      .prepare(
        `SELECT i.queue_order AS queueOrder FROM runs r JOIN execution_intents i ON i.attempt_id=r.active_attempt_id
         WHERE r.organization_id=? AND r.workspace_id=? AND r.id=?`,
      )
      .get(scope.organizationId, scope.workspaceId, runId) as { queueOrder: number } | undefined;
    // Untracked legacy intents have no immutable order; their position stays unknown.
    if (row === undefined) return null;
    const ahead = this.db.prepare(aheadSql).get(row.queueOrder, row.queueOrder) as { ahead: unknown };
    return count(ahead.ahead) + 1;
  }
}

export function readInstallationStatus(
  db: DatabaseSync,
  settings: Settings,
  runReads: RunReads,
  operation: StatusOperation,
  capacityReason?: (run: Run) => Exclude<RunQueueFacts['capacityBlockReason'], undefined>,
): PoolUsageFacts | RunQueueFacts | UnfinishedWorkFacts {
  const reads = new InstallationStatusReads(db, settings, runReads, capacityReason);
  return transaction(db, () => {
    if (operation.kind === 'getPoolUsage') return reads.pool();
    return operation.kind === 'getUnfinishedWork' ? reads.unfinished() : reads.queue(operation.key);
  });
}
