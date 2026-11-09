import type { DatabaseSync } from 'node:sqlite';
import type { InputCommand, InputKey, InputRecord, InputReceipt, InputAdvance, InputStorage } from '../../../ports/inputs.js';
import { INPUT_METADATA_CHARGE_BYTES } from '../../../ports/inputs.js';
import { nextVersion, normalizedName, requireRule } from '../../../domain/namespaces/index.js';
import { canonicalInputKey } from './input-validation.js';
import { lower } from './input.js';
import type { Entities } from './entities.js';
import type { Settings } from './settings.js';

export interface InputRow { id: string; organization_id: string; workspace_id: string; folder_id: string;
 name: string; sha256: string; bytes: number; offset: number; version: number; state: InputRecord['state']; reason: InputRecord['reason'] }
export function inputRecord(row: InputRow): InputRecord {
  return { ...canonicalInputKey({ id: row.id, scope: { kind: 'workspace', organizationId: row.organization_id,
    workspaceId: row.workspace_id } }), folderId: row.folder_id, name: row.name, sha256: row.sha256,
  bytes: row.bytes, offset: row.offset, version: row.version, state: row.state, reason: row.reason };
}
export class Inputs {
  constructor(private readonly db: DatabaseSync, private readonly entities: Entities, private readonly settings: Settings) {}
  get(key: InputKey): InputRecord {
    const { scope, id } = canonicalInputKey(key);
    const row = this.db.prepare('SELECT * FROM input_blobs WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, id) as unknown as InputRow | undefined;
    requireRule(row !== undefined, 'not_found'); return inputRecord(row);
  }
  storage(): InputStorage {
    const row = this.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get();
    const pool = this.settings.chain({ kind: 'installation' }).installation.values.pool;
    requireRule(typeof row?.charged_bytes === 'number' && Number.isSafeInteger(row.charged_bytes));
    return { chargedBytes: row.charged_bytes, allocationBytes: pool.storageBytes, freeSpaceReserveBytes: pool.freeSpaceReserveBytes };
  }
  control(command: InputCommand): InputRecord | InputReceipt {
    if (command.kind === 'createInput') return this.create(command);
    const key = canonicalInputKey({ scope: command.request.scope, id: command.id });
    const previous = this.get(key);
    requireRule(previous.version === command.request.expectedVersion, 'conflict');
    if (command.kind === 'sealInput') {
      requireRule(previous.state === 'staging' && previous.offset === previous.bytes, 'conflict');
    } else requireRule(['staging', 'publishing', 'published', 'failed'].includes(previous.state), 'conflict');
    const state = command.kind === 'sealInput' ? 'publishing' : 'deleting';
    const column = command.kind === 'sealInput' ? 'seal_request_id' : 'delete_request_id';
    const version = nextVersion(previous.version);
    this.db.prepare(`UPDATE input_blobs SET state=?,version=?,reason=NULL,${column}=?
      WHERE organization_id=? AND workspace_id=? AND id=? AND ${column} IS NULL`)
      .run(state, version, lower(command.request.requestId), key.scope.organizationId, key.scope.workspaceId, key.id);
    requireRule(this.get(key).version === version, 'conflict');
    return { ...key, requestId: lower(command.request.requestId), operation: command.kind === 'sealInput' ? 'seal' : 'delete', acceptedVersion: version };
  }
  private create(command: Extract<InputCommand, { kind: 'createInput' }>): InputRecord {
    const request = command.request;
    const key = canonicalInputKey({ scope: request.scope, id: command.id });
    const workspace = this.entities.workspace({ kind: 'organization', organizationId: key.scope.organizationId }, key.scope.workspaceId);
    const folder = lower(request.folderId ?? workspace.rootFolderId); this.entities.folderRow(key.scope, folder);
    const storage = this.storage();
    const charge = request.bytes + INPUT_METADATA_CHARGE_BYTES;
    requireRule(Number.isSafeInteger(charge + storage.freeSpaceReserveBytes) &&
      storage.chargedBytes <= Number.MAX_SAFE_INTEGER - charge - storage.freeSpaceReserveBytes, 'capacity_unavailable');
    requireRule(storage.chargedBytes + charge + storage.freeSpaceReserveBytes <= storage.allocationBytes, 'capacity_unavailable');
    this.db.prepare(`INSERT INTO input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,create_request_id)
      VALUES(?,?,?,?,?,?,?,0,1,'staging',?)`).run(key.id, key.scope.organizationId, key.scope.workspaceId,
      folder, normalizedName(request.name), request.sha256, request.bytes, lower(request.requestId));
    return this.get(key);
  }
  advance(command: InputAdvance): InputRecord {
    const key = canonicalInputKey(command.key);
    const previous = this.get(key);
    requireRule(previous.version === command.expectedVersion, 'conflict');
    const change = this.advanceChange(command, previous);
    this.db.prepare(`UPDATE input_blobs SET state=?,offset=?,reason=?,version=?
      WHERE organization_id=? AND workspace_id=? AND id=?`)
      .run(change.state, change.offset, change.reason, nextVersion(previous.version), key.scope.organizationId, key.scope.workspaceId, key.id);
    return this.get(key);
  }
  private advanceChange(command: InputAdvance, previous: InputRecord): Pick<InputRecord, 'state' | 'offset' | 'reason'> {
    const unchanged = { state: previous.state, offset: previous.offset, reason: null };
    switch (command.kind) {
      case 'commitInputOffset':
        requireRule(previous.state === 'staging' && command.offset > previous.offset && command.offset <= previous.bytes, 'conflict');
        return { ...unchanged, offset: command.offset };
      case 'publishInput':
        requireRule(previous.state === 'publishing' && previous.offset === previous.bytes, 'conflict');
        return { ...unchanged, state: 'published' };
      case 'deleteInputBytes':
        requireRule(previous.state === 'deleting', 'conflict'); return { ...unchanged, state: 'deleted' };
      case 'failInput':
        requireRule(['staging', 'publishing', 'published', 'deleting'].includes(previous.state), 'conflict');
        return { ...unchanged, state: previous.state === 'deleting' ? 'deleting' : 'failed', reason: command.reason };
    }
  }
}
