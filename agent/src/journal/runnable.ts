import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { RunnablePage, RunnableRequest } from './protocol.js';
import { runnableInput } from './input.js';
import { Failure, transaction } from './sql.js';

interface RunnableRow {
  id: number; attempt_id: string; organization_id: string; workspace_id: string; generation: number;
}

/** Index-filter before joining: inactive queue/reservation history is never paged. */
export class RunnableScan {
  private readonly charged: StatementSync;
  private readonly queued: StatementSync;
  private readonly delivery: StatementSync;
  private readonly deliveryUpper: StatementSync;
  constructor(private readonly db: DatabaseSync) {
    this.charged = db.prepare(`SELECT r.id,a.attempt_id,a.organization_id,a.workspace_id,a.generation
      FROM (SELECT id,attempt_id FROM reservations INDEXED BY reservation_charged
        WHERE charged=1 AND id>? ORDER BY id LIMIT ?) r
      JOIN accepted_attempts a ON a.attempt_id=r.attempt_id ORDER BY r.id`);
    this.queued = db.prepare(`SELECT q.id,a.attempt_id,a.organization_id,a.workspace_id,a.generation
      FROM (SELECT id,attempt_id FROM admission_queue INDEXED BY admission_pending
        WHERE pending=1 AND id>? ORDER BY id LIMIT ?) q
      JOIN accepted_attempts a ON a.attempt_id=q.attempt_id ORDER BY q.id`);
    const eligible = `FROM accepted_attempts a INDEXED BY output_delivery_pending WHERE a.delivery_pending=1
      AND EXISTS(SELECT 1 FROM reservations r WHERE r.attempt_id=a.attempt_id AND r.charged=0)`;
    this.delivery = db.prepare(`SELECT a.id,a.attempt_id,a.organization_id,a.workspace_id,a.generation ${eligible}
      AND a.id>? AND a.id<=? ORDER BY a.id LIMIT ?`);
    this.deliveryUpper = db.prepare(`SELECT COALESCE(MAX(a.id),0) AS through ${eligible}`);
  }

  read(input: RunnableRequest): RunnablePage {
    let page: RunnableRequest;
    try { page = runnableInput(input); } catch { throw new Failure('invalid_input'); }
    if (page.lane === 'delivery') return transaction(this.db, () => this.readDelivery(page));
    const query = page.lane === 'charged' ? this.charged : this.queued;
    const rows = query.all(page.cursor ?? 0, page.limit + 1) as unknown as RunnableRow[];
    const attempts = rows.slice(0, page.limit).map(row => ({ attemptId: row.attempt_id,
      organizationId: row.organization_id, workspaceId: row.workspace_id, generation: row.generation }));
    const cursor = rows[page.limit - 1]?.id;
    return rows.length > page.limit && cursor !== undefined ? { attempts, cursor } : { attempts };
  }
  private readDelivery(page: RunnableRequest): RunnablePage {
    const through = page.through ?? this.deliveryUpper.get()?.through;
    if (typeof through !== 'number' || !Number.isSafeInteger(through) || through < 0) throw new Failure('unavailable');
    const rows = this.delivery.all(page.cursor ?? 0, through, page.limit + 1) as unknown as RunnableRow[];
    const attempts = rows.slice(0, page.limit).map(row => ({ attemptId: row.attempt_id,
      organizationId: row.organization_id, workspaceId: row.workspace_id, generation: row.generation }));
    const cursor = rows[page.limit - 1]?.id;
    return { attempts, through, ...(rows.length > page.limit && cursor !== undefined ? { cursor } : {}) };
  }
}
