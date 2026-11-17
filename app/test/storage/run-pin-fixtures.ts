import { prepareRunPinCommand } from '../../src/application/runs/index.js';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { digest, scope } from './fixture.js';

export const pinnedAt = '2026-11-14T12:00:30.000Z';
export function pinCommand(kind: 'pinRun' | 'unpinRun', id: string, requestId: string, target: WorkspaceScope = scope, requestedAt = pinnedAt) {
  return prepareRunPinCommand({ kind, id, requestedAt, request: { scope: target, requestId } }, digest);
}
export function pin(f: { store: Store }, kind: 'pinRun' | 'unpinRun', id: string, requestId: string, target: WorkspaceScope = scope) {
  return f.store.execute({ kind: 'runPin', command: pinCommand(kind, id, requestId, target) });
}
export function epoch(db: DatabaseSync, target: WorkspaceScope = scope): number {
  return Number(db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE workspace_id=?').get(target.workspaceId)?.epoch);
}
export function runIds(db: DatabaseSync): string[] {
  return db.prepare('SELECT id FROM runs ORDER BY requested_at,id').all().map(row => String(row.id));
}
export function pins(db: DatabaseSync) {
  return db.prepare('SELECT run_id,organization_id,workspace_id,pinned_at,request_id FROM run_pins ORDER BY run_id').all();
}
