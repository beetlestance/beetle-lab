import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import { MAX_ATTEMPT_OBSERVATION_BYTES, mergeAttemptObservation } from '../../../domain/runs/index.js';
import type { AttemptObservation } from '../../../domain/runs/index.js';
import { nextVersion, requireRule } from '../../../domain/namespaces/index.js';
import { DISPATCH_OBSERVATION_REQUEST_BYTES } from '../../../ports/dispatch.js';
import type { DispatchKey, DispatchObservation, DispatchObservationRequest } from '../../../ports/dispatch.js';
import { checkedJournalAuthority, boundedCopy } from './input-values.js';
import { captureDispatchKey } from './dispatch-values.js';
import type { RunReads } from './run-reads.js';
import { transaction } from './schema.js';
import { previousSnapshot, persistSnapshot } from './output-payloads/index.js';

interface RecordRow {
  journal_authority: string | null; snapshot_bytes: number | null; snapshot_json: string | null; result_observed: number; execution_charged: number;
  acknowledged_generation: number | null; delivery_attempt_id: string | null; generation: number | null;
}
interface DeliveryRow { intent_digest: string; execution_intent_id: string | null;
  possible_delivery: number; first_delivery_at: string | null }

function captureRequest(input: DispatchObservationRequest): DispatchObservationRequest {
  const value = boundedCopy(input, DISPATCH_OBSERVATION_REQUEST_BYTES);
  requireRule(value !== null && typeof value === 'object' && Object.keys(value).length === 3
    && Object.hasOwn(value, 'key') && Object.hasOwn(value, 'snapshot') && Object.hasOwn(value, 'journalAuthority'));
  checkedJournalAuthority(value.journalAuthority);
  return { key: captureDispatchKey(value.key), snapshot: value.snapshot, journalAuthority: value.journalAuthority };
}

function project(run: Run, merged: Readonly<AttemptObservation>): Run {
  if (['finished', 'cancelled', 'errored'].includes(run.state)) return run;
  return { ...run, state: merged.runState, outcome: 'pending', validationStatus: 'pending',
    cancellationRequested: run.cancellationRequested || merged.snapshot.cancelRequested };
}

function projectionChanged(before: Run, after: Run): boolean {
  return before.state !== after.state || before.outcome !== after.outcome
    || before.validationStatus !== after.validationStatus || before.cancellationRequested !== after.cancellationRequested;
}

/** Owns the immediate matched observation transaction; callers must not wrap it. */
export class DispatchObservations {
  constructor(private readonly db: DatabaseSync, private readonly reads: RunReads) {}

  observe(input: DispatchObservationRequest): DispatchObservation {
    const request = captureRequest(input);
    return transaction(this.db, () => this.matched(request));
  }

  private matched(request: DispatchObservationRequest): DispatchObservation {
    const { key, snapshot } = request;
    const row = this.record(key);
    requireRule(row.journal_authority === request.journalAuthority);
    this.requireDelivery(key, row);
    requireRule(row.snapshot_bytes === null || row.snapshot_bytes <= MAX_ATTEMPT_OBSERVATION_BYTES);
    const previous = previousSnapshot(this.db, key, row);
    const merged = mergeAttemptObservation({ expected: key.attempt, previous: previous as AttemptObservation['snapshot'] | null, incoming: snapshot });
    const runKey = { id: key.runId, scope: { kind: 'workspace' as const,
      organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId } };
    const before = this.reads.get(runKey);
    const projected = project(before, merged);
    const runChanged = projectionChanged(before, projected);
    const version = runChanged ? nextVersion(before.version) : before.version;
    const executionCharged = row.execution_charged === 1
      && merged.snapshot.admission?.state !== 'released' && merged.snapshot.admission?.state !== 'rejected';
    this.persist(key, merged, executionCharged);
    if (runChanged) this.db.prepare(`UPDATE runs SET version=?,state=?,outcome=?,validation_status=?,cancellation_requested=? WHERE id=?`)
      .run(version, projected.state, projected.outcome, projected.validationStatus, Number(projected.cancellationRequested), key.runId);
    return boundedCopy({ run: this.reads.get(runKey), snapshot: merged.snapshot, executionCharged, runChanged }, 1_048_576);
  }

  private record(key: DispatchKey): RecordRow {
    // CASE guards SQLite's returned text: no Offer, registry or historical payload is selected.
    const row = this.db.prepare(`SELECT length(CAST(e.snapshot_json AS BLOB)) snapshot_bytes,
      CASE WHEN length(CAST(e.snapshot_json AS BLOB))<=2048 THEN e.snapshot_json ELSE NULL END snapshot_json,
      CASE WHEN length(CAST(e.journal_authority AS BLOB))=36 THEN e.journal_authority ELSE NULL END journal_authority,
      e.result_observed,e.execution_charged,e.acknowledged_generation,e.delivery_attempt_id,a.generation
      FROM execution_records e JOIN attempts a ON a.id=e.attempt_id JOIN runs r ON r.id=e.run_id
      WHERE e.attempt_id=? AND e.run_id=? AND e.organization_id=? AND e.workspace_id=? AND e.intent_digest=?
      AND a.run_id=e.run_id AND a.organization_id=e.organization_id AND a.workspace_id=e.workspace_id
      AND a.intent_digest=e.intent_digest AND a.foundation_owned=1 AND a.execution_intent_id=e.attempt_id
      AND r.organization_id=e.organization_id AND r.workspace_id=e.workspace_id AND r.active_attempt_id=e.attempt_id`)
      .get(key.attempt.attemptId, key.runId, key.attempt.organizationId, key.attempt.workspaceId, key.attempt.intentDigest) as unknown as RecordRow | undefined;
    requireRule(row !== undefined);
    return row;
  }

  private requireDelivery(key: DispatchKey, row: RecordRow): void {
    const delivery = this.db.prepare(`SELECT intent_digest,execution_intent_id,possible_delivery,first_delivery_at
      FROM dispatch_outbox WHERE attempt_id=?`).get(key.attempt.attemptId) as unknown as DeliveryRow | undefined;
    if (delivery !== undefined) requireRule(delivery.intent_digest === key.attempt.intentDigest
      && delivery.execution_intent_id === key.attempt.attemptId && delivery.possible_delivery === 1 && delivery.first_delivery_at !== null);
    if (row.acknowledged_generation === null) {
      requireRule(delivery !== undefined);
      requireRule(row.delivery_attempt_id === key.attempt.attemptId);
      requireRule(row.generation === null && row.snapshot_bytes === null);
    } else {
      requireRule(row.acknowledged_generation === 1 && row.generation === 1);
      requireRule(row.delivery_attempt_id === null && row.snapshot_bytes !== null);
    }
  }

  private persist(key: DispatchKey, merged: Readonly<AttemptObservation>, charged: boolean): void {
    persistSnapshot(this.db, key, merged.snapshot, charged);
    this.db.prepare('UPDATE attempts SET generation=1,state=? WHERE id=?').run(merged.snapshot.state, key.attempt.attemptId);
    this.db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(key.attempt.attemptId);
  }
}
