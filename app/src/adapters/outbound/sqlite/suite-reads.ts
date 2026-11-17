import { captureRevisionSummary, revisionSummaryColumns } from './suite-row.js';
import { captureNamespaceId, namespaceIdColumn } from './namespace-rows.js';
import { StorageError } from './protocol.js';
import type { DatabaseSync } from 'node:sqlite';
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
    const value = boundedCopy(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as { identity: string; after: string },
      1024,
    );
    requireRule(value.identity === identity(query));
    uuid(value.after);
    return lower(value.after);
  } catch {
    throw new StorageError('invalid_input');
  }
}
export class SuiteReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {}
  list(query: SuiteList | RevisionList) {
    this.suites.workspace(query.scope);
    const revision = 'suiteId' in query;
    if (revision) this.suites.getSuite({ scope: query.scope, id: query.suiteId });
    const table = revision ? 'suite_revisions' : 'suites';
    const args = [
      lower(query.scope.organizationId),
      lower(query.scope.workspaceId),
      ...(revision ? [lower(query.suiteId)] : []),
      after(query),
      query.limit + 1,
    ];
    const rows = this.db
      .prepare(
        `SELECT ${revision ? revisionSummaryColumns : namespaceIdColumn} FROM ${table} WHERE organization_id=? AND workspace_id=?
      ${revision ? 'AND suite_id=?' : ''} AND id>? ORDER BY ${table}.id LIMIT ?`,
      )
      .all(...args)
      .map((row) => (revision ? captureRevisionSummary(row, query.scope, query.suiteId) : captureNamespaceId(row)));
    const selected = rows.slice(0, query.limit);
    const items = selected.map((row) => {
      const key = { scope: query.scope, id: row.id };
      if (!revision) return this.suites.getSuite(key);
      if (!('suiteId' in row)) throw new StorageError('unavailable');
      return row;
    });
    const last = selected.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ identity: identity(query), after: last.id })).toString('base64url')
        : null;
    return {
      scope: normalizedScope(query.scope),
      ...(revision ? { suiteId: lower(query.suiteId) } : {}),
      items,
      nextCursor,
    };
  }
}
