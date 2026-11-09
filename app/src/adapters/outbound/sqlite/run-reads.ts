import type { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { Run, RunPage } from '@beetle/contracts/api';
import type { RunKey, RunList } from '../../../ports/runs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { boundedCopy, lower, scopeKey, sha256, uuid } from './input-values.js';
import { normalizedScope } from './suites.js';
import type { Suites } from './suites.js';
import { StorageError } from './protocol.js';

interface Row { snapshot_json: string; version: number; state: Run['state']; outcome: Run['outcome'];
  validation_status: Run['validationStatus']; active_attempt_id: string; cancellation_requested: number; reason: Run['reason'] }
function queryIdentity(query: RunList): string { return sha256(JSON.stringify(['runs', scopeKey(query.scope), query.limit])); }
function after(query: RunList): string {
  if (query.cursor === undefined) return '';
  try {
    const cursor = boundedCopy(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as { identity: string; after: string }, 1024);
    requireRule(cursor.identity === queryIdentity(query)); uuid(cursor.after); return lower(cursor.after);
  } catch { throw new StorageError('invalid_input'); }
}
export class RunReads {
  constructor(private readonly db: DatabaseSync, private readonly suites: Suites) {}
  get(key: RunKey): Run {
    const scope = normalizedScope(key.scope);
    const row = this.db.prepare('SELECT * FROM runs WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, lower(key.id)) as unknown as Row | undefined;
    requireRule(row !== undefined, 'not_found');
    const initial = JSON.parse(row.snapshot_json) as Run;
    const run = { ...initial, version: row.version, state: row.state, outcome: row.outcome, validationStatus: row.validation_status,
      activeAttemptId: row.active_attempt_id, cancellationRequested: row.cancellation_requested === 1, reason: row.reason };
    requireRule(validateApi('Run', run).ok);
    requireRule(run.id === lower(key.id) && run.scope.organizationId === scope.organizationId
      && run.scope.workspaceId === scope.workspaceId, 'not_found');
    return run;
  }
  list(query: RunList): RunPage {
    this.suites.workspace(query.scope);
    const scope = normalizedScope(query.scope);
    const rows = this.db.prepare(`SELECT id FROM runs WHERE organization_id=? AND workspace_id=? AND id>? ORDER BY id LIMIT ?`)
      .all(scope.organizationId, scope.workspaceId, after(query), query.limit + 1) as unknown as { id: string }[];
    const selected = rows.slice(0, query.limit); const last = selected.at(-1);
    const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify({ identity: queryIdentity(query), after: last.id })).toString('base64url') : null;
    return { scope, items: selected.map(row => this.get({ scope, id: row.id })), nextCursor };
  }
}
