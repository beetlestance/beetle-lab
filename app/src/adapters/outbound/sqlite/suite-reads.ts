import { captureRevisionSummary, revisionSummaryColumns } from './suite-row.js';
import { StorageError } from './protocol.js';
import type { DatabaseSync } from 'node:sqlite';
import { normalizedScope } from './suites.js';
import type { SuiteList, RevisionList } from '../../../ports/suites.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { lower, scopeKey, sha256, boundedCopy, uuid } from './input.js';
import type { Suites } from './suites.js';
import { SuiteListReads } from './suite-list/index.js';

function identity(query: RevisionList): string {
  return sha256(JSON.stringify([scopeKey(query.scope), query.limit, lower(query.suiteId)]));
}
function after(query: RevisionList): string {
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
  private readonly listing: SuiteListReads;
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {
    this.listing = new SuiteListReads(db, suites);
  }
  list(query: SuiteList | RevisionList) {
    if (!('suiteId' in query)) return this.listing.list(query);
    this.suites.workspace(query.scope);
    this.suites.getSuite({ scope: query.scope, id: query.suiteId });
    const rows = this.db
      .prepare(
        `SELECT ${revisionSummaryColumns} FROM suite_revisions WHERE organization_id=? AND workspace_id=?
      AND suite_id=? AND id>? ORDER BY suite_revisions.id LIMIT ?`,
      )
      .all(
        lower(query.scope.organizationId),
        lower(query.scope.workspaceId),
        lower(query.suiteId),
        after(query),
        query.limit + 1,
      )
      .map((row) => captureRevisionSummary(row, query.scope, query.suiteId));
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ identity: identity(query), after: last.id })).toString('base64url')
        : null;
    return { scope: normalizedScope(query.scope), suiteId: lower(query.suiteId), items, nextCursor };
  }
}
