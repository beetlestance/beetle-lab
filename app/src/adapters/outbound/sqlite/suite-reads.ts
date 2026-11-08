import { StorageError } from './protocol.js';
import type { DatabaseSync } from 'node:sqlite';
import type { SuiteRevisionSummary } from '@beetle/contracts/api';
import { normalizedScope } from './suites.js';
import type { SuiteList, RevisionList } from '../../../ports/suites.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { lower, scopeKey, sha256, boundedCopy, uuid } from './input.js';
import type { Suites } from './suites.js';

function identity(query: SuiteList | RevisionList): string {
  return sha256(JSON.stringify([scopeKey(query.scope), query.limit, 'suiteId' in query ? lower(query.suiteId) : null]));
}
function after(query: SuiteList | RevisionList): string {
  if (query.cursor === undefined) return '';
  try {
    const value = boundedCopy(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as
      { identity: string; after: string }, 1024);
    requireRule(value.identity === identity(query)); uuid(value.after); return lower(value.after);
  } catch { throw new StorageError('invalid_input'); }
}
export class SuiteReads {
  constructor(private readonly db: DatabaseSync, private readonly suites: Suites) {}
  list(query: SuiteList | RevisionList) {
    this.suites.workspace(query.scope);
    const revision = 'suiteId' in query;
    if (revision) this.suites.getSuite({ scope: query.scope, id: query.suiteId });
    const table = revision ? 'suite_revisions' : 'suites';
    const args = [lower(query.scope.organizationId), lower(query.scope.workspaceId),
      ...(revision ? [lower(query.suiteId)] : []), after(query), query.limit + 1];
    const rows = this.db.prepare(`SELECT ${revision ? 'id,suite_id,ordinal,digest' : 'id'} FROM ${table} WHERE organization_id=? AND workspace_id=?
      ${revision ? 'AND suite_id=?' : ''} AND id>? ORDER BY id LIMIT ?`).all(...args) as unknown as { id: string }[];
    const selected = rows.slice(0, query.limit);
    const items = selected.map(row => {
      const key = { scope: query.scope, id: row.id };
      if (!revision) return this.suites.getSuite(key);
      const summary = row as unknown as { id: string; suite_id: string; ordinal: number; digest: string };
      return { id: summary.id, suiteId: summary.suite_id, ordinal: summary.ordinal, digest: summary.digest,
        scope: normalizedScope(query.scope), engineId: 'k6', configVersion: 1, preflightStatus: 'passed' } satisfies SuiteRevisionSummary;
    });
    const last = selected.at(-1);
    const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify({
      identity: identity(query), after: last.id })).toString('base64url') : null;
    return { scope: normalizedScope(query.scope), ...(revision ? { suiteId: lower(query.suiteId) } : {}), items, nextCursor };
  }
}
