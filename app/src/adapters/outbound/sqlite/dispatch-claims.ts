import type { DatabaseSync } from 'node:sqlite';
import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { DispatchKey, DispatchClaim, DispatchScan, DispatchPage, DispatchOffer } from '../../../ports/dispatch.js';
import { DISPATCH_PAGE_BYTES } from '../../../ports/dispatch.js';
import type { RunConfiguration } from '../../../ports/runs.js';
import { nextVersion, requireRule } from '../../../domain/namespaces/index.js';
import { checkedRunConfiguration } from './run-profiles.js';
import type { Settings } from './settings.js';
import { transaction } from './schema.js';
import { captureDispatchKey } from './dispatch-values.js';
import { captureDispatchOfferReply } from './dispatch-offer-reply.js';
import { boundedCopy } from './input-values.js';
import { originalFact, pendingFacts, chargedFacts, factKey, retainedClaim, orderOf } from './dispatch-candidates.js';
import type { DispatchFact } from './dispatch-candidates.js';
import { DispatchEligibilityOwner } from './dispatch-eligibility.js';
import { captureScan, comparePosition, encodeCursor, decodeCursor } from './dispatch-cursors.js';
import { reserveRunOutput } from './output-reservations.js';
import { StorageError } from './protocol.js';

class CapacityLost extends Error {}
function position(row: DispatchFact) { return { order: orderOf(row), id: row.attempt_id }; }
/** Each entrypoint owns its transaction; Store must delegate without nesting. */
export class DispatchClaims {
  private readonly config: RunConfiguration;
  constructor(private readonly db: DatabaseSync, private readonly settings: Settings, config: RunConfiguration) {
    this.config = checkedRunConfiguration(config);
  }
  scan(input: DispatchScan): DispatchPage {
    const query = captureScan(input);
    return transaction(this.db, () => this.page(query));
  }
  private page(query: DispatchScan): DispatchPage {
    const installation = this.settings.capacity().installation.id;
    const rows = query.lane === 'queued' ? pendingFacts(this.db) : chargedFacts(this.db);
    const sorted = rows.sort((a, b) => comparePosition(position(a), position(b)));
    const cursor = query.cursor === undefined ? { installation, lane: query.lane,
      upper: sorted.length === 0 ? { order: 0, id: '' } : position(sorted.at(-1)!), after: { order: 0, id: '' } }
      : decodeCursor(query.cursor, installation, query.lane);
    const remaining = sorted.filter(row => comparePosition(position(row), cursor.after) > 0
      && comparePosition(position(row), cursor.upper) <= 0);
    const policy = query.lane === 'queued' ? new DispatchEligibilityOwner(this.db, this.settings, this.config) : null;
    const barrier = policy?.barrier(rows) ?? null;
    const items = remaining.slice(0, query.limit).map(row => {
      const retained = retainedClaim(row);
      if (query.lane === 'reconcile' && retained === null) throw new StorageError('unavailable');
      return { key: factKey(row), order: orderOf(row), after: encodeCursor({ ...cursor, after: position(row) }),
        eligibility: retained === 'unbound' ? { kind: 'blocked' as const, reason: 'ownership_unknown' as const }
          : retained !== null ? { kind: 'ready' as const } : policy!.evaluate(row, barrier) };
    });
    return boundedCopy({ items, nextCursor: remaining.length > items.length ? items.at(-1)!.after : null }, DISPATCH_PAGE_BYTES);
  }
  readOffer(input: DispatchKey): DispatchOffer {
    const key = captureDispatchKey(input);
    return transaction(this.db, () => {
      const row = this.db.prepare(`SELECT length(CAST(a.offer_json AS BLOB)) bytes,
        CASE WHEN length(CAST(a.offer_json AS BLOB))<=2097152 THEN a.offer_json ELSE NULL END offer_json
        FROM attempts a JOIN runs r ON r.id=a.run_id AND r.organization_id=a.organization_id
        AND r.workspace_id=a.workspace_id
        WHERE a.id=? AND a.run_id=? AND a.organization_id=? AND a.workspace_id=? AND a.intent_digest=?`)
        .get(key.attempt.attemptId, key.runId, key.attempt.organizationId, key.attempt.workspaceId, key.attempt.intentDigest);
      requireRule(row !== undefined, 'not_found');
      requireRule(typeof row.bytes === 'number' && row.bytes <= RUNNER_MAXIMUM_OFFER_BYTES && typeof row.offer_json === 'string');
      const result = captureDispatchOfferReply({ key, offer: JSON.parse(row.offer_json) as unknown }, key);
      requireRule(encodeJson(result.offer, RUNNER_MAXIMUM_OFFER_BYTES) === row.offer_json);
      return result;
    });
  }
  claim(input: DispatchKey): DispatchClaim {
    const key = captureDispatchKey(input);
    try { return transaction(this.db, () => boundedCopy(this.authorize(key), DISPATCH_PAGE_BYTES)); }
    catch (error) {
      if (error instanceof CapacityLost) return { kind: 'blocked', reason: 'capacity_unknown' };
      throw error;
    }
  }
  private authorize(key: DispatchKey): DispatchClaim {
    const row = originalFact(this.db, key);
    if (row === undefined) return { kind: 'blocked', reason: 'not_queued' };
    const retained = retainedClaim(row);
    if (retained === 'unbound') return { kind: 'blocked', reason: 'ownership_unknown' };
    if (retained === 'acknowledged') return { kind: 'acknowledged', journalAuthority: row.journal_authority! };
    if (retained === 'replay') return { kind: 'replay', key, journalAuthority: row.journal_authority! };
    const pending = pendingFacts(this.db);
    const policy = new DispatchEligibilityOwner(this.db, this.settings, this.config);
    const decision = policy.evaluate(row, policy.barrier(pending));
    if (decision.kind === 'blocked') return decision;
    const runtime = policy.capacity.runtime;
    if (runtime === null || policy.storage === null) throw new CapacityLost();
    this.persist(key, row, policy.storage, runtime.journalAuthority);
    // RuntimeCapacity returns the same frozen original only while its original lease remains valid.
    if (this.settings.capacity().runtime !== runtime) throw new CapacityLost();
    return { kind: 'claimed', key, journalAuthority: runtime.journalAuthority };
  }
  private persist(key: DispatchKey, row: DispatchFact, storage: { allocationBytes: number; reserveBytes: number }, authority: string): void {
    const version = nextVersion(row.version);
    this.db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,
      intent_digest,delivery_attempt_id,output_attempt_id,journal_authority) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(key.attempt.attemptId, row.queue_order!, key.runId, key.attempt.organizationId,
        key.attempt.workspaceId, key.attempt.intentDigest, key.attempt.attemptId, key.attempt.attemptId, authority);
    reserveRunOutput(this.db, key, storage);
    this.db.prepare('UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at=? WHERE attempt_id=?')
      .run(new Date().toISOString(), key.attempt.attemptId);
    this.db.prepare("UPDATE runs SET state='dispatching',version=? WHERE id=?").run(version, key.runId);
  }
}
