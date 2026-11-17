import type { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { InputUsagePage, InputUsageQuery, RevisionDependency } from '../../../ports/inputs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { canonicalInputKey } from './input-validation.js';
import { boundedCopy, scopeKey, sha256, uuid } from './input-values.js';
import { sqlIntegerColumn, sqlTextColumn } from './sql-columns.js';
import type { Entities } from './entities.js';
import { StorageError } from './protocol.js';

const columns = [
  sqlTextColumn('revision_id', 45, false, 'p.'),
  sqlIntegerColumn('ordinal', false, 'r.'),
  sqlTextColumn('id', 45, false, 's.', 'suite_id'),
  sqlTextColumn('name', 512, false, 's.'),
  sqlTextColumn('current_revision_id', 45, true, 's.'),
].join(',');
/** Covering pin index drives order; revision and suite rows are primary-key lookups. */
export const inputUsageSql = `SELECT ${columns} FROM revision_input_pins p INDEXED BY input_pins_usage
 JOIN suite_revisions r ON r.id=p.revision_id AND r.organization_id=p.organization_id AND r.workspace_id=p.workspace_id
 JOIN suites s ON s.id=r.suite_id AND s.organization_id=p.organization_id AND s.workspace_id=p.workspace_id
 WHERE p.organization_id=? AND p.workspace_id=? AND p.input_id=? AND p.revision_id>?
 ORDER BY p.revision_id LIMIT ?`;

function identity(query: InputUsageQuery): string {
  return sha256(JSON.stringify(['inputUsage', query.limit, scopeKey(query.key.scope), query.key.id]));
}
function after(query: InputUsageQuery): string {
  if (query.cursor === undefined) return '';
  try {
    const cursor = boundedCopy(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as { identity: string; after: string },
      1024,
    );
    requireRule(cursor.identity === identity(query) && typeof cursor.after === 'string');
    uuid(cursor.after);
    requireRule(cursor.after === cursor.after.toLowerCase());
    return cursor.after;
  } catch {
    throw new StorageError('invalid_input');
  }
}
function dependency(row: Record<string, unknown>): RevisionDependency {
  const checked = validateApi('RevisionDependency', {
    suiteId: row.suite_id,
    suiteName: row.name,
    revisionId: row.revision_id,
    ordinal: row.ordinal,
    current: row.current_revision_id === row.revision_id,
  });
  if (!checked.ok) throw new StorageError('unavailable');
  return checked.value;
}
export class InputUsageReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly entities: Entities,
  ) {}
  /** Bounded page plus the maintained exact total; the input itself must exist. */
  usage(input: InputUsageQuery): InputUsagePage {
    const query = { ...input, key: canonicalInputKey(input.key) };
    const { scope, id } = query.key;
    this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
    const start = after(query);
    const owner = this.db
      .prepare(
        `SELECT coalesce(u.revisions,0) AS total FROM input_blobs b LEFT JOIN input_usage_counts u
        ON u.organization_id=b.organization_id AND u.workspace_id=b.workspace_id AND u.input_id=b.id
        WHERE b.organization_id=? AND b.workspace_id=? AND b.id=?`,
      )
      .get(scope.organizationId, scope.workspaceId, id);
    requireRule(owner !== undefined, 'not_found');
    const total = owner.total;
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new StorageError('unavailable');
    const rows = this.db
      .prepare(inputUsageSql)
      .all(scope.organizationId, scope.workspaceId, id, start, query.limit + 1)
      .map((row) => dependency(row as Record<string, unknown>));
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ identity: identity(query), after: last.revisionId })).toString('base64url')
        : null;
    if (items.length > total) throw new StorageError('unavailable');
    return { total, items, nextCursor };
  }
}
