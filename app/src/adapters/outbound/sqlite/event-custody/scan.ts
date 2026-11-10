import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { validatePrimitive } from '@beetle/contracts';
import { EVENT_CURSOR_BYTES, EVENT_PAGE_BYTES } from '../../../../ports/events.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import type { EventPage, EventScan } from '../../../../ports/events.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { captureDispatchKey } from '../dispatch-values.js';
import { boundedCopy } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { closed, cursor, natural, scanQuery } from './values.js';
type Position = readonly [number, string];
interface Cursor { installation: string; upper: Position; after: Position }
const condition = 'acknowledged_generation=1 AND event_pending=1';
const columns = 'queue_order,attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority';
function encode(value: Cursor): string {
  const result = Buffer.from(JSON.stringify({ lane: 'events', ...value })).toString('base64url'); cursor(result); return result;
}
function position(input: unknown): asserts input is Position {
  requireRule(Array.isArray(input) && input.length === 2); natural(input[0]);
  requireRule(input[0] === 0 ? input[1] === '' : validatePrimitive('uuid', input[1]).ok);
}
function decode(input: string, installation: string): Cursor {
  try { return checkedCursor(input, installation); } catch { throw new StorageError('invalid_input'); }
}
function checkedCursor(input: string, installation: string): Cursor {
  cursor(input);
  const value = boundedCopy(JSON.parse(Buffer.from(input, 'base64url').toString()) as unknown, EVENT_CURSOR_BYTES) as Cursor & {lane: string};
  closed(value, ['lane', 'installation', 'upper', 'after']);
  requireRule(value.lane === 'events' && value.installation === installation); position(value.upper); position(value.after);
  requireRule(value.after[0] < value.upper[0] || value.after[0] === value.upper[0] && value.after[1] <= value.upper[1]);
  const result = { installation, upper: value.upper, after: value.after };
  requireRule(encode(result) === input); return result;
}
function rowPosition(row: Record<string, SQLOutputValue>): Position {
  natural(row.queue_order); requireRule(typeof row.attempt_id === 'string'); return [row.queue_order, row.attempt_id];
}
export function scanEvents(db: DatabaseSync, installation: string, query: EventScan): EventPage {
  scanQuery(query);
  const last = db.prepare(`SELECT queue_order,attempt_id FROM execution_records INDEXED BY execution_event_pending
    WHERE ${condition} ORDER BY queue_order DESC,attempt_id DESC LIMIT 1`).get();
  const state: Cursor = query.cursor === undefined ? { installation, upper: last ? rowPosition(last) : [0, ''], after: [0, ''] }
    : decode(query.cursor, installation);
  const rows = db.prepare(`SELECT ${columns} FROM execution_records INDEXED BY execution_event_pending
    WHERE ${condition} AND (queue_order,attempt_id)>(?,?) AND (queue_order,attempt_id)<=(?,?)
    ORDER BY queue_order,attempt_id LIMIT ?`).all(...state.after, ...state.upper, query.limit + 1);
  const items = rows.slice(0, query.limit).map(row => {
    const at = rowPosition(row);
    const key = captureDispatchKey({ runId: row.run_id, attempt: { organizationId: row.organization_id,
      workspaceId: row.workspace_id, attemptId: row.attempt_id, intentDigest: row.intent_digest, generation: 1 } });
    const common = { order: at[0], after: encode({ ...state, after: at }) };
    if (row.journal_authority === null) return { ...common, kind: 'unbound' as const, key };
    return { ...common, kind: 'ready' as const, binding: captureEventBinding({ key, journalAuthority: row.journal_authority }) };
  });
  try { return boundedCopy({ items, nextCursor: rows.length > query.limit ? items.at(-1)!.after : null }, EVENT_PAGE_BYTES); }
  catch { throw new StorageError('unavailable'); }
}
