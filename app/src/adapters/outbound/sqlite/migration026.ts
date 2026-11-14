import {namespaceProtectionSql,namespaceTables} from './namespace-deletion/protection.js';
/** Permanent bounded namespace identity, including generated root/settings IDs. No parent FK or refunds. */
const identity = (value: string) => `EXISTS(SELECT 1 FROM namespace_deletions WHERE id=lower(${value}) OR root_id=lower(${value}) OR settings_id=lower(${value}))`;
export const migration026 = `
CREATE INDEX settings_namespace ON settings(organization_id,workspace_id,id);
CREATE INDEX backend_retired_scope ON backend_retired_runs(organization_id,workspace_id,run_id);
CREATE TABLE namespace_deletions (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 36 AND 45 AND id=lower(id)),kind TEXT NOT NULL CHECK(kind IN ('organization','workspace','folder')),
 scope_key TEXT NOT NULL CHECK(length(scope_key)<=110),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 2 AND 9007199254740991),
 root_id TEXT UNIQUE CHECK(root_id IS NULL OR (length(root_id) BETWEEN 36 AND 45 AND root_id=lower(root_id))),
 settings_id TEXT UNIQUE CHECK(settings_id IS NULL OR (length(settings_id) BETWEEN 36 AND 45 AND settings_id=lower(settings_id))),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=2048));
CREATE TRIGGER namespace_marker_funding BEFORE INSERT ON namespace_deletions BEGIN
 SELECT CASE WHEN (SELECT charged_bytes FROM installation_storage_usage WHERE id=1) IS NULL
 OR NOT EXISTS(SELECT 1 FROM settings s,installation_storage_usage u WHERE s.scope_key='installation' AND u.id=1
 AND typeof(json_extract(s.value_json,'$.pool.storageBytes')) IN ('integer','real')
 AND json_extract(s.value_json,'$.pool.storageBytes') BETWEEN 0 AND 9007199254740991
 AND json_extract(s.value_json,'$.pool.storageBytes')=CAST(json_extract(s.value_json,'$.pool.storageBytes') AS INTEGER)
 AND typeof(json_extract(s.value_json,'$.pool.freeSpaceReserveBytes')) IN ('integer','real')
 AND json_extract(s.value_json,'$.pool.freeSpaceReserveBytes') BETWEEN 0 AND 9007199254740991
 AND json_extract(s.value_json,'$.pool.freeSpaceReserveBytes')=CAST(json_extract(s.value_json,'$.pool.freeSpaceReserveBytes') AS INTEGER)
 AND u.charged_bytes<=9007199254740991-2048
 AND u.charged_bytes+2048<=json_extract(s.value_json,'$.pool.storageBytes')-json_extract(s.value_json,'$.pool.freeSpaceReserveBytes'))
 THEN RAISE(ABORT,'namespace marker capacity') END; END;
CREATE TRIGGER namespace_marker_binding BEFORE INSERT ON namespace_deletions BEGIN
 ${(['organization','workspace','folder'] as const).map(kind=>`SELECT CASE WHEN NEW.kind='${kind}' AND EXISTS(
 SELECT 1 FROM ${namespaceTables[kind]} target WHERE target.id=NEW.id AND (${namespaceProtectionSql(kind)}))
 THEN RAISE(ABORT,'namespace not empty') END;`).join('\n')}

 SELECT CASE WHEN NOT (
 (NEW.kind='organization' AND NEW.scope_key='installation' AND NEW.root_id IS NULL AND EXISTS(
  SELECT 1 FROM organizations o JOIN settings s ON s.scope_key='organization:'||o.id
  WHERE o.id=NEW.id AND o.version=NEW.version-1 AND s.id=NEW.settings_id)) OR
 (NEW.kind='workspace' AND EXISTS(SELECT 1 FROM workspaces w JOIN settings s ON s.scope_key='workspace:'||w.organization_id||':'||w.id
  WHERE w.id=NEW.id AND NEW.scope_key='organization:'||w.organization_id AND w.version=NEW.version-1
  AND NEW.root_id=w.root_folder_id AND NEW.settings_id=s.id)
  AND NOT EXISTS(SELECT 1 FROM folders f JOIN workspaces w ON w.id=NEW.id AND f.organization_id=w.organization_id
    WHERE f.workspace_id=NEW.id AND f.id!=NEW.root_id)) OR
 (NEW.kind='folder' AND NEW.root_id IS NULL AND NEW.settings_id IS NULL AND EXISTS(
  SELECT 1 FROM folders f WHERE f.id=NEW.id AND f.parent_id IS NOT NULL AND f.version=NEW.version-1
  AND NEW.scope_key='workspace:'||f.organization_id||':'||f.workspace_id)))
 THEN RAISE(ABORT,'namespace marker binding') END; END;
CREATE TRIGGER namespace_marker_charge AFTER INSERT ON namespace_deletions BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+2048 WHERE id=1;
 DELETE FROM settings WHERE id=NEW.settings_id;
 DELETE FROM folders WHERE id=NEW.root_id OR (NEW.kind='folder' AND id=NEW.id);
 DELETE FROM workspaces WHERE NEW.kind='workspace' AND id=NEW.id;
 DELETE FROM organizations WHERE NEW.kind='organization' AND id=NEW.id;
END;
CREATE TRIGGER namespace_marker_immutable BEFORE UPDATE ON namespace_deletions BEGIN SELECT RAISE(ABORT,'retained namespace identity'); END;
CREATE TRIGGER namespace_marker_retained BEFORE DELETE ON namespace_deletions BEGIN SELECT RAISE(ABORT,'retained namespace identity'); END;
${['organizations','workspaces','folders','settings'].map(table => `CREATE TRIGGER ${table}_deleted_identity BEFORE INSERT ON ${table}
 WHEN ${identity('NEW.id')} BEGIN SELECT RAISE(ABORT,'deleted namespace identity'); END;`).join('\n')}
${['organizations','workspaces','folders','settings'].map(table => `CREATE TRIGGER ${table}_deleted_identity_update BEFORE UPDATE OF id ON ${table}
 WHEN ${identity('NEW.id')} BEGIN SELECT RAISE(ABORT,'deleted namespace identity'); END;`).join('\n')}
${[['organizations','organization'],['workspaces','workspace']].map(([table,kind]) => `CREATE TRIGGER ${table}_delete_marker BEFORE DELETE ON ${table}
 WHEN NOT EXISTS(SELECT 1 FROM namespace_deletions WHERE kind='${kind}' AND id=OLD.id AND version=OLD.version+1)
 BEGIN SELECT RAISE(ABORT,'namespace deletion marker required'); END;`).join('\n')}
CREATE TRIGGER folders_delete_marker BEFORE DELETE ON folders
 WHEN NOT EXISTS(SELECT 1 FROM namespace_deletions WHERE (kind='folder' AND id=OLD.id AND version=OLD.version+1)
 OR (kind='workspace' AND root_id=OLD.id AND id=OLD.workspace_id)) BEGIN SELECT RAISE(ABORT,'namespace deletion marker required'); END;
CREATE TRIGGER settings_delete_marker BEFORE DELETE ON settings
 WHEN NOT EXISTS(SELECT 1 FROM namespace_deletions WHERE settings_id=OLD.id) BEGIN SELECT RAISE(ABORT,'namespace deletion marker required'); END;
PRAGMA user_version=26;
`;
