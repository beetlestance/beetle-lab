import type { DatabaseSync } from 'node:sqlite';
import type { InputList, InputRecoveryPage, InputPage } from '../../../ports/inputs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { boundedCopy, lower, scopeKey, sha256, uuid } from './input.js';
import { inputRecord } from './inputs.js';
import type { InputRow } from './inputs.js';
import type { Entities } from './entities.js';
import { StorageError } from './protocol.js';

type Query = InputList | InputRecoveryPage;
interface Cursor { identity: string; after: string[] }
function identity(query: Query): string {
  return sha256(JSON.stringify(['inputs', query.limit, 'scope' in query ? scopeKey(query.scope) : 'recovery']));
}
function continuation(query: Query): string[] {
  const recovery = !('scope' in query);
  if (query.cursor === undefined) return recovery ? ['', '', '', ''] : [''];
  try {
    const cursor = boundedCopy(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Cursor, 1024);
    requireRule(cursor.identity === identity(query) && Array.isArray(cursor.after));
    requireRule(cursor.after.length === (recovery ? 4 : 1));
    cursor.after.slice(recovery ? 1 : 0).forEach(value => { uuid(value); requireRule(value === lower(value)); });
    if (recovery) requireRule(['failed', 'deleting', 'published', 'publishing', 'staging'].includes(cursor.after[0]!));
    return cursor.after;
  } catch { throw new StorageError('invalid_input'); }
}
export class InputReads {
  constructor(private readonly db: DatabaseSync, private readonly entities: Entities) {}
  list(query: Query): InputPage {
    const after = continuation(query);
    let rows: InputRow[];
    if ('scope' in query) {
      const scope = query.scope;
      this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
      rows = this.db.prepare(`SELECT * FROM input_blobs WHERE organization_id=? AND workspace_id=? AND id>?
        ORDER BY id LIMIT ?`).all(lower(scope.organizationId), lower(scope.workspaceId), after[0]!, query.limit + 1) as unknown as InputRow[];
    } else rows = this.db.prepare(`SELECT * FROM input_blobs INDEXED BY inputs_recovery
      WHERE state IN ('failed','deleting','published','publishing','staging') AND (state,organization_id,workspace_id,id)>(?,?,?,?)
      ORDER BY state,organization_id,workspace_id,id LIMIT ?`).all(...after, query.limit + 1) as unknown as InputRow[];
    const selected = rows.slice(0, query.limit);
    const last = selected.at(-1);
    const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify({ identity: identity(query),
      after: 'scope' in query ? [last.id] : [last.state, last.organization_id, last.workspace_id, last.id] })).toString('base64url') : null;
    return { items: selected.map(inputRecord), nextCursor };
  }
}
