import type { DatabaseSync } from 'node:sqlite';
import type { InputList, InputRecoveryPage, InputPage, InputState } from '../../../ports/inputs.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { boundedCopy, lower, scopeKey, sha256, uuid } from './input.js';
import { inputRecord, inputColumns, inputSource } from './input-row.js';
import type { InputRecord } from '../../../ports/inputs.js';
import type { Entities } from './entities.js';
import { StorageError } from './protocol.js';

type Query = InputList | InputRecoveryPage;
interface Cursor {
  identity: string;
  after: string[];
}
function identity(query: Query): string {
  const owner = 'scope' in query ? scopeKey(query.scope) : query.mode === 'pending' ? 'pendingRecovery' : 'recovery';
  return sha256(JSON.stringify(['inputs', query.limit, owner]));
}
function recoveryStates(query: InputRecoveryPage): readonly InputState[] {
  return query.mode === 'pending'
    ? ['deleting', 'publishing']
    : ['failed', 'deleting', 'published', 'publishing', 'staging'];
}
function continuation(query: Query): string[] {
  const recovery = !('scope' in query);
  if (query.cursor === undefined) return recovery ? ['', '', '', ''] : [''];
  try {
    const cursor = boundedCopy(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Cursor, 1024);
    requireRule(cursor.identity === identity(query) && Array.isArray(cursor.after));
    requireRule(cursor.after.length === (recovery ? 4 : 1));
    cursor.after.slice(recovery ? 1 : 0).forEach((value) => {
      uuid(value);
      requireRule(value === lower(value));
    });
    if (recovery) requireRule(recoveryStates(query).some((state) => state === cursor.after[0]));
    return cursor.after;
  } catch {
    throw new StorageError('invalid_input');
  }
}
export class InputReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly entities: Entities,
  ) {}
  list(query: Query): InputPage {
    const after = continuation(query);
    let rows: InputRecord[];
    if ('scope' in query) {
      const scope = query.scope;
      this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
      rows = this.db
        .prepare(
          `SELECT ${inputColumns} FROM ${inputSource()} WHERE input_blobs.organization_id=?
        AND input_blobs.workspace_id=? AND input_blobs.id>? ORDER BY input_blobs.id LIMIT ?`,
        )
        .all(lower(scope.organizationId), lower(scope.workspaceId), after[0]!, query.limit + 1)
        .map((row) => inputRecord(row, scope));
    } else rows = this.recovery(query, after);
    const selected = rows.slice(0, query.limit);
    const last = selected.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              identity: identity(query),
              after:
                'scope' in query ? [last.id] : [last.state, last.scope.organizationId, last.scope.workspaceId, last.id],
            }),
          ).toString('base64url')
        : null;
    return { items: selected, nextCursor };
  }
  private recovery(query: InputRecoveryPage, after: readonly string[]): InputRecord[] {
    const states = recoveryStates(query);
    return this.db
      .prepare(
        `SELECT ${inputColumns} FROM ${inputSource('INDEXED BY inputs_recovery')}
      WHERE input_blobs.state IN (${states.map(() => '?').join(',')})
      AND (input_blobs.state,input_blobs.organization_id,input_blobs.workspace_id,input_blobs.id)>(?,?,?,?)
      ORDER BY input_blobs.state,input_blobs.organization_id,input_blobs.workspace_id,input_blobs.id LIMIT ?`,
      )
      .all(...states, ...after, query.limit + 1)
      .map((row) => inputRecord(row));
  }
}
