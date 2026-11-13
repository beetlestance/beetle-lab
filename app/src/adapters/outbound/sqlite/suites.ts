import { normalizedScope } from './input-values.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import { k6ConfigSchema } from '../execution-profiles/index.js';
import type { Suite, SuiteRevision, WorkspaceScope } from '@beetle/contracts/api';
import type { SuiteCommand, SuiteKey } from '../../../ports/suites.js';
import { digestMutationIntent } from '../../../application/namespaces/index.js';
import { inputManifest } from '../../../domain/suites/index.js';
import { requireRule, normalizedName, foldedName, nextVersion } from '../../../domain/namespaces/index.js';
import type { Entities } from './entities.js';
import { lower, sha256 } from './input.js';

interface SuiteRow { id: string; organization_id: string; workspace_id: string; folder_id: string;
 name: string; version: number; current_revision_id: string | null }
interface RevisionRow { id: string; organization_id: string; workspace_id: string; suite_id: string;
 ordinal: number; digest: string; config_json: string; input_manifest_json: string }
export { normalizedScope } from './input-values.js';
export class Suites {
  constructor(private readonly db: DatabaseSync, private readonly entities: Entities) {}
  workspace(scope: WorkspaceScope) {
    return this.entities.workspace({ kind: 'organization', organizationId: scope.organizationId }, scope.workspaceId);
  }
  getSuite(key: SuiteKey): Suite {
    const scope = normalizedScope(key.scope);
    const row = this.db.prepare('SELECT * FROM suites WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, lower(key.id)) as unknown as SuiteRow | undefined;
    requireRule(row !== undefined, 'not_found');
    return { id: row.id, scope, name: row.name, folderId: row.folder_id, version: row.version,
      currentRevisionId: row.current_revision_id };
  }
  getRevision(key: SuiteKey): SuiteRevision {
    const scope = normalizedScope(key.scope);
    const row = this.db.prepare('SELECT * FROM suite_revisions WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, lower(key.id)) as unknown as RevisionRow | undefined;
    requireRule(row !== undefined, 'not_found');
    return { id: row.id, scope, suiteId: row.suite_id, ordinal: row.ordinal, digest: row.digest,
      engineId: 'k6', configVersion: 1, preflightStatus: 'passed', config: JSON.parse(row.config_json) as SuiteRevision['config'],
      inputManifest: JSON.parse(row.input_manifest_json) as SuiteRevision['inputManifest'] };
  }
  change(command: SuiteCommand): Suite | SuiteRevision {
    if (command.kind === 'createSuiteRevision') return this.append(command);
    const scope = normalizedScope(command.request.scope);
    const workspace = this.workspace(scope);
    const previous = command.kind === 'patchSuite' ? this.getSuite({ scope, id: command.id }) : undefined;
    if (previous && command.kind === 'patchSuite') requireRule(previous.version === command.request.expectedVersion, 'conflict');
    const folder = lower(command.request.folderId ?? previous?.folderId ?? workspace.rootFolderId);
    this.entities.folderRow(scope, folder);
    const name = normalizedName(command.request.name ?? previous!.name);
    if (previous) this.db.prepare('UPDATE suites SET folder_id=?,name=?,folded_name=?,version=? WHERE id=?')
      .run(folder, name, foldedName(name), nextVersion(previous.version), previous.id);
    else this.db.prepare(`INSERT INTO suites(id,organization_id,workspace_id,folder_id,name,folded_name,version)
      VALUES (?,?,?,?,?,?,1)`).run(lower(command.id), scope.organizationId, scope.workspaceId, folder, name, foldedName(name));
    return this.getSuite({ scope, id: command.id });
  }
  private append(command: Extract<SuiteCommand, { kind: 'createSuiteRevision' }>): SuiteRevision {
    const scope = normalizedScope(command.request.scope);
    const suite = this.getSuite({ scope, id: command.suiteId });
    requireRule(suite.version === command.request.expectedVersion, 'conflict');
    const config = command.request.config;
    requireRule(k6ConfigSchema.validate(config));
    const manifest = inputManifest(config);
    for (const pin of manifest) {
      const row = this.db.prepare(`SELECT id FROM input_blobs WHERE organization_id=? AND workspace_id=?
        AND id=? AND sha256=? AND bytes=? AND state='published'`)
        .get(scope.organizationId, scope.workspaceId, pin.id, pin.sha256, pin.bytes);
      requireRule(row !== undefined, 'not_found');
    }
    const ordinalRow = this.db.prepare('SELECT coalesce(max(ordinal),0) AS ordinal FROM suite_revisions WHERE suite_id=?').get(suite.id);
    const previousOrdinal = Number(ordinalRow?.ordinal);
    const ordinal = previousOrdinal === 0 ? 1 : nextVersion(previousOrdinal);
    let canonicalConfig = '';
    digestMutationIntent(config, text => { canonicalConfig = text; return sha256(text); });
    const digest = digestMutationIntent({ engineId: 'k6', configVersion: 1, config, inputManifest: manifest }, sha256);
    this.db.prepare(`INSERT INTO suite_revisions(id,suite_id,organization_id,workspace_id,ordinal,digest,config_json,input_manifest_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(lower(command.id), suite.id, scope.organizationId, scope.workspaceId,
      ordinal, digest, canonicalConfig, encodeJson(manifest, 65536));
    const insertPin = this.db.prepare('INSERT INTO revision_input_pins VALUES(?,?,?,?,?,?)');
    for (const pin of manifest) insertPin.run(lower(command.id), scope.organizationId, scope.workspaceId, pin.id, pin.sha256, pin.bytes);
    this.db.prepare('UPDATE suites SET current_revision_id=?,version=? WHERE id=?')
      .run(lower(command.id), nextVersion(suite.version), suite.id);
    return this.getRevision({ scope, id: command.id });
  }
}
