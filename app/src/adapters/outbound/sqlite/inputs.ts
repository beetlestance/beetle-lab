import { inputRecord, inputColumns, inputSource } from './input-row.js';
import { StorageError } from './protocol.js';
import { storageFits } from '../../../domain/settings/index.js';
import type { DatabaseSync } from 'node:sqlite';
import type {
  InputCommand,
  InputKey,
  InputRecord,
  InputReceipt,
  InputAdvance,
  InputShapeRecord,
  InputStorage,
} from '../../../ports/inputs.js';
import { INPUT_METADATA_CHARGE_BYTES } from '../../../ports/inputs.js';
import { nextVersion, normalizedName, requireRule } from '../../../domain/namespaces/index.js';
import { canonicalInputKey } from './input-validation.js';
import { lower } from './input.js';
import type { Entities } from './entities.js';
import type { Settings } from './settings.js';

export class Inputs {
  constructor(
    private readonly db: DatabaseSync,
    private readonly entities: Entities,
    private readonly settings: Settings,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  get(key: InputKey): InputRecord {
    const { scope, id } = canonicalInputKey(key);
    const row = this.db
      .prepare(
        `SELECT ${inputColumns} FROM ${inputSource()}
        WHERE input_blobs.organization_id=? AND input_blobs.workspace_id=? AND input_blobs.id=?`,
      )
      .get(scope.organizationId, scope.workspaceId, id);
    requireRule(row !== undefined, 'not_found');
    const result = inputRecord(row, scope);
    if (result.id !== id) throw new StorageError('unavailable');
    return result;
  }
  storage(): InputStorage {
    const row = this.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get();
    const pool = this.settings.chain({ kind: 'installation' }).installation.values.pool;
    requireRule(typeof row?.charged_bytes === 'number' && Number.isSafeInteger(row.charged_bytes));
    return {
      chargedBytes: row.charged_bytes,
      allocationBytes: pool.storageBytes,
      freeSpaceReserveBytes: pool.freeSpaceReserveBytes,
    };
  }
  control(command: InputCommand): InputRecord | InputReceipt {
    if (command.kind === 'createInput') return this.create(command);
    const key = canonicalInputKey({ scope: command.request.scope, id: command.id });
    const previous = this.get(key);
    requireRule(previous.version === command.request.expectedVersion, 'conflict');
    if (command.kind === 'sealInput') {
      requireRule(previous.state === 'staging' && previous.offset === previous.bytes, 'conflict');
    } else {
      requireRule(['staging', 'publishing', 'published', 'failed'].includes(previous.state), 'conflict');
      if (previous.usedByCount !== 0) throw new StorageError('protected_dependency');
    }
    const state = command.kind === 'sealInput' ? 'publishing' : 'deleting';
    const column = command.kind === 'sealInput' ? 'seal_request_id' : 'delete_request_id';
    const version = nextVersion(previous.version);
    this.db
      .prepare(
        `UPDATE input_blobs SET state=?,version=?,reason=NULL,${column}=?
      WHERE organization_id=? AND workspace_id=? AND id=? AND ${column} IS NULL`,
      )
      .run(state, version, lower(command.request.requestId), key.scope.organizationId, key.scope.workspaceId, key.id);
    requireRule(this.get(key).version === version, 'conflict');
    return {
      ...key,
      requestId: lower(command.request.requestId),
      operation: command.kind === 'sealInput' ? 'seal' : 'delete',
      acceptedVersion: version,
    };
  }
  private create(command: Extract<InputCommand, { kind: 'createInput' }>): InputRecord {
    const request = command.request;
    const key = canonicalInputKey({ scope: request.scope, id: command.id });
    const workspace = this.entities.workspace(
      { kind: 'organization', organizationId: key.scope.organizationId },
      key.scope.workspaceId,
    );
    const folder = lower(request.folderId ?? workspace.rootFolderId);
    this.entities.folderRow(key.scope, folder);
    const storage = this.storage();
    const charge = request.bytes + INPUT_METADATA_CHARGE_BYTES;
    requireRule(
      storageFits({
        chargedBytes: storage.chargedBytes,
        requestedBytes: charge,
        allocationBytes: storage.allocationBytes,
        reserveBytes: storage.freeSpaceReserveBytes,
      }),
      'capacity_unavailable',
    );
    this.db
      .prepare(
        `INSERT INTO input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,
        create_request_id,created_at) VALUES(?,?,?,?,?,?,?,0,1,'staging',?,?)`,
      )
      .run(
        key.id,
        key.scope.organizationId,
        key.scope.workspaceId,
        folder,
        normalizedName(request.name),
        request.sha256,
        request.bytes,
        lower(request.requestId),
        this.now(),
      );
    return this.get(key);
  }
  advance(command: InputAdvance): InputRecord {
    const key = canonicalInputKey(command.key);
    const previous = this.get(key);
    requireRule(previous.version === command.expectedVersion, 'conflict');
    const change = this.advanceChange(command, previous);
    this.db
      .prepare(
        `UPDATE input_blobs SET state=?,offset=?,reason=?,version=?,published_at=?
      WHERE organization_id=? AND workspace_id=? AND id=?`,
      )
      .run(
        change.state,
        change.offset,
        change.reason,
        nextVersion(previous.version),
        command.kind === 'publishInput' ? this.now() : (previous.publishedAt ?? null),
        key.scope.organizationId,
        key.scope.workspaceId,
        key.id,
      );
    return this.get(key);
  }
  /** Insert-once; SQL guards bind the exact published identity and size. */
  recordShape(shape: InputShapeRecord): InputRecord {
    const key = canonicalInputKey(shape.key);
    const previous = this.get(key);
    requireRule(previous.state === 'published' && previous.sha256 === shape.sha256, 'conflict');
    requireRule(
      previous.bytes === shape.bytes && previous.rowCount === null && previous.columnCount === null,
      'conflict',
    );
    this.db
      .prepare('INSERT INTO input_shapes VALUES(?,?,?,?,?,?,?)')
      .run(
        key.scope.organizationId,
        key.scope.workspaceId,
        key.id,
        shape.sha256,
        shape.bytes,
        shape.rowCount,
        shape.columnCount,
      );
    return this.get(key);
  }
  private advanceChange(
    command: InputAdvance,
    previous: InputRecord,
  ): Pick<InputRecord, 'state' | 'offset' | 'reason'> {
    const unchanged = { state: previous.state, offset: previous.offset, reason: null };
    switch (command.kind) {
      case 'commitInputOffset':
        requireRule(
          previous.state === 'staging' && command.offset > previous.offset && command.offset <= previous.bytes,
          'conflict',
        );
        return { ...unchanged, offset: command.offset };
      case 'publishInput':
        requireRule(previous.state === 'publishing' && previous.offset === previous.bytes, 'conflict');
        return { ...unchanged, state: 'published' };
      case 'deleteInputBytes':
        requireRule(previous.state === 'deleting', 'conflict');
        return { ...unchanged, state: 'deleted' };
      case 'failInput':
        requireRule(['staging', 'publishing', 'published', 'deleting'].includes(previous.state), 'conflict');
        return { ...unchanged, state: previous.state === 'deleting' ? 'deleting' : 'failed', reason: command.reason };
    }
  }
}
