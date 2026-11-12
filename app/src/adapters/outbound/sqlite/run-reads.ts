import { readHistorySummaries } from './run-history/index.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeRunListCursor, normalizeRunListQuery, runListPageMatches, validateApi } from '@beetle/contracts/api';
import type { Run, RunPage } from '@beetle/contracts/api';
import type { RunKey, RunList } from '../../../ports/runs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { lower } from './input-values.js';
import { normalizedScope } from './suites.js';
import type { Suites } from './suites.js';
import { runListStatement } from './run-list-query.js';
import { transaction } from './schema.js';

interface Row { snapshot_json: string; version: number; state: Run['state']; outcome: Run['outcome'];
  validation_status: Run['validationStatus']; active_attempt_id: string; cancellation_requested: number; reason: Run['reason'] }
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
  list(input: RunList): RunPage {
    const { scope: owner, ...page } = input;
    const query = normalizeRunListQuery(page);
    const scope = normalizedScope(owner);
    const statement = runListStatement(input);
    return transaction(this.db, () => {
      this.suites.workspace(scope);
      const rows = this.db.prepare(statement.sql).all(...statement.values) as unknown as { id: string; requested_at: string }[];
      const selected = rows.slice(0, query.limit); const last = selected.at(-1);
      const nextCursor = rows.length > query.limit && last
        ? encodeRunListCursor({ scope, query, requestedAt: last.requested_at, id: last.id }) : null;
      const items = selected.map(row => this.get({ scope, id: row.id }));
      const result = { scope, items, summaries: readHistorySummaries(this.db, scope, items), nextCursor };
      if (!runListPageMatches(result, scope, query)) throw new Error('Invalid persisted run page');
      return result;
    });
  }
}
