import { sqlIntegerColumn } from './sql-columns.js';
import { StorageError } from './protocol.js';
import { captureSuiteRow, captureRevisionRow, suiteColumns, revisionProjection } from './suite-row.js';
import type { RevisionRunCount } from './suite-row.js';
import { normalizedScope } from './input-values.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import { k6ConfigSchema } from '../execution-profiles/index.js';
import type { Suite, SuiteRevision, WorkspaceScope, SuiteMetadataChanges } from '@beetle/contracts/api';
import type { SuiteCommand, SuiteKey } from '../../../ports/suites.js';
import { digestMutationIntent } from '../../../application/namespaces/index.js';
import { inputManifest } from '../../../domain/suites/index.js';
import { requireRule, normalizedName, foldedName, nextVersion } from '../../../domain/namespaces/index.js';
import type { Entities } from './entities.js';
import { lower, sha256 } from './input.js';

export { normalizedScope } from './input-values.js';
/** Omitted keeps the current description, null clears it, text follows name rules. */
function nextDescription(supplied: string | null | undefined, previous: Suite | undefined): string | null {
  if (supplied === undefined) return previous?.description ?? null;
  return supplied === null ? null : normalizedName(supplied, 280);
}
export class Suites {
  constructor(
    private readonly db: DatabaseSync,
    private readonly entities: Entities,
    /** Installation administrator display name, read inside the caller's transaction. */
    private readonly administrator: () => string = () => 'Administrator',
  ) {}
  workspace(scope: WorkspaceScope) {
    return this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
  }
  getSuite(key: SuiteKey): Suite {
    const scope = normalizedScope(key.scope);
    const row = this.db
      .prepare(`SELECT ${suiteColumns} FROM suites WHERE organization_id=? AND workspace_id=? AND id=?`)
      .get(scope.organizationId, scope.workspaceId, lower(key.id));
    requireRule(row !== undefined, 'not_found');
    return captureSuiteRow(row, { scope, id: key.id });
  }
  getRevision(key: SuiteKey, count: RevisionRunCount = 'stored'): SuiteRevision {
    const scope = normalizedScope(key.scope);
    const projection = revisionProjection(count);
    const row = this.db
      .prepare(`SELECT ${projection} FROM suite_revisions WHERE organization_id=? AND workspace_id=? AND id=?`)
      .get(scope.organizationId, scope.workspaceId, lower(key.id));
    requireRule(row !== undefined, 'not_found');
    return captureRevisionRow(row, { scope, id: key.id });
  }
  change(command: SuiteCommand): Suite | SuiteRevision {
    if (command.kind === 'createSuiteRevision') return this.append(command);
    const scope = normalizedScope(command.request.scope);
    const workspace = this.workspace(scope);
    const previous = command.kind === 'patchSuite' ? this.getSuite({ scope, id: command.id }) : undefined;
    if (previous && command.kind === 'patchSuite')
      requireRule(previous.version === command.request.expectedVersion, 'conflict');
    const folder = lower(command.request.folderId ?? previous?.folderId ?? workspace.rootFolderId);
    this.entities.folderRow(scope, folder);
    const name = normalizedName(command.request.name ?? previous!.name);
    const description = nextDescription(command.request.description, previous);
    if (previous)
      this.db
        .prepare('UPDATE suites SET folder_id=?,name=?,folded_name=?,description=?,version=? WHERE id=?')
        .run(folder, name, foldedName(name), description, nextVersion(previous.version), previous.id);
    else
      this.db
        .prepare(
          `INSERT INTO suites(id,organization_id,workspace_id,folder_id,name,folded_name,description,version)
      VALUES (?,?,?,?,?,?,?,1)`,
        )
        .run(lower(command.id), scope.organizationId, scope.workspaceId, folder, name, foldedName(name), description);
    return this.getSuite({ scope, id: command.id });
  }
  private append(command: Extract<SuiteCommand, { kind: 'createSuiteRevision' }>): SuiteRevision {
    const scope = normalizedScope(command.request.scope);
    const suite = this.getSuite({ scope, id: command.suiteId });
    requireRule(suite.version === command.request.expectedVersion, 'conflict');
    const metadata = command.request.metadata ? this.metadata(scope, suite, command.request.metadata) : null;
    const config = command.request.config;
    requireRule(k6ConfigSchema.validate(config));
    const manifest = inputManifest(config);
    for (const pin of manifest) {
      const row = this.db
        .prepare(
          `SELECT id FROM input_blobs WHERE organization_id=? AND workspace_id=?
        AND id=? AND sha256=? AND bytes=? AND state='published'`,
        )
        .get(scope.organizationId, scope.workspaceId, pin.id, pin.sha256, pin.bytes);
      requireRule(row !== undefined, 'not_found');
    }
    const ordinal = this.nextOrdinal(scope, suite.id);
    let canonicalConfig = '';
    digestMutationIntent(config, (text) => {
      canonicalConfig = text;
      return sha256(text);
    });
    const digest = digestMutationIntent({ engineId: 'k6', configVersion: 1, config, inputManifest: manifest }, sha256);
    const message = command.request.message === undefined ? null : normalizedName(command.request.message, 280);
    this.db
      .prepare(
        `INSERT INTO suite_revisions(id,suite_id,organization_id,workspace_id,ordinal,digest,config_json,input_manifest_json,
      saved_at,message,saved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        lower(command.id),
        suite.id,
        scope.organizationId,
        scope.workspaceId,
        ordinal,
        digest,
        canonicalConfig,
        encodeJson(manifest, 65536),
        command.savedAt,
        message,
        normalizedName(this.administrator()),
      );
    const insertPin = this.db.prepare('INSERT INTO revision_input_pins VALUES(?,?,?,?,?,?)');
    for (const pin of manifest)
      insertPin.run(lower(command.id), scope.organizationId, scope.workspaceId, pin.id, pin.sha256, pin.bytes);
    const version = nextVersion(suite.version);
    if (metadata)
      this.db
        .prepare(
          `UPDATE suites SET current_revision_id=?,version=?,folder_id=?,name=?,folded_name=?,description=?
      WHERE organization_id=? AND workspace_id=? AND id=?`,
        )
        .run(
          lower(command.id),
          version,
          metadata.folder,
          metadata.name,
          foldedName(metadata.name),
          metadata.description,
          scope.organizationId,
          scope.workspaceId,
          suite.id,
        );
    else
      this.db
        .prepare('UPDATE suites SET current_revision_id=?,version=? WHERE id=?')
        .run(lower(command.id), version, suite.id);
    return this.getRevision({ scope, id: command.id }, 'new');
  }
  private metadata(scope: WorkspaceScope, suite: Suite, change: SuiteMetadataChanges) {
    const folder = lower(change.folderId ?? suite.folderId);
    this.entities.folderRow(scope, folder);
    const name = change.name === undefined ? suite.name : normalizedName(change.name);
    const occupied = this.db
      .prepare(
        `SELECT 1 AS occupied FROM suites WHERE organization_id=? AND workspace_id=?
      AND folder_id=? AND folded_name=? AND id<>? LIMIT 1`,
      )
      .get(scope.organizationId, scope.workspaceId, folder, foldedName(name), suite.id);
    if (occupied) throw new StorageError('suite_name_conflict');
    return { folder, name, description: nextDescription(change.description, suite) };
  }
  private nextOrdinal(scope: WorkspaceScope, suiteId: string): number {
    const row = this.db
      .prepare(
        `SELECT ${sqlIntegerColumn('ordinal')} FROM suite_revisions
      WHERE organization_id=? AND workspace_id=? AND suite_id=? ORDER BY suite_revisions.ordinal DESC LIMIT 1`,
      )
      .get(scope.organizationId, scope.workspaceId, suiteId);
    if (row === undefined) return 1;
    if (typeof row.ordinal !== 'number' || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1)
      throw new StorageError('unavailable');
    return nextVersion(row.ordinal);
  }
}
