import {namespaceProtectionSql} from './namespace-deletion/protection.js';
import {workspaceBusySql} from './workspace-retirement/visibility.js';
/** Retain FK-linked originals; only public visibility and the private active-name key change. */
export const migration028 = `
ALTER TABLE workspaces ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1));
CREATE INDEX workspaces_visible ON workspaces(organization_id,id) WHERE retired=0;
CREATE INDEX execution_workspace_busy ON execution_records(organization_id,workspace_id) WHERE execution_charged=1;
CREATE INDEX exports_workspace_busy ON export_jobs(organization_id,workspace_id) WHERE state NOT IN ('ready','failed','cancelled') OR execution_charged=1;
CREATE INDEX inputs_workspace_busy ON input_blobs(organization_id,workspace_id) WHERE state IN ('staging','publishing','deleting');
DROP TRIGGER namespace_marker_binding;
CREATE TRIGGER namespace_marker_binding BEFORE INSERT ON namespace_deletions BEGIN
 SELECT CASE WHEN NEW.kind='organization' AND EXISTS(SELECT 1 FROM organizations target WHERE target.id=NEW.id AND (${namespaceProtectionSql('organization')}))
 THEN RAISE(ABORT,'namespace not empty') END;
 SELECT CASE WHEN NEW.kind='folder' AND EXISTS(SELECT 1 FROM folders target WHERE target.id=NEW.id AND (${namespaceProtectionSql('folder')}))
 THEN RAISE(ABORT,'namespace not empty') END;
 SELECT CASE WHEN NEW.kind='workspace' AND EXISTS(SELECT 1 FROM workspaces target WHERE target.id=NEW.id AND (${workspaceBusySql}))
 THEN RAISE(ABORT,'workspace has unfinished work') END;
 SELECT CASE WHEN NOT (
 (NEW.kind='organization' AND NEW.scope_key='installation' AND NEW.root_id IS NULL AND EXISTS(
 SELECT 1 FROM organizations o JOIN settings s ON s.scope_key='organization:'||o.id WHERE o.id=NEW.id AND o.version=NEW.version-1 AND s.id=NEW.settings_id)) OR
 (NEW.kind='workspace' AND EXISTS(SELECT 1 FROM workspaces w JOIN settings s ON s.scope_key='workspace:'||w.organization_id||':'||w.id
 WHERE w.id=NEW.id AND w.retired=0 AND NEW.scope_key='organization:'||w.organization_id AND w.version=NEW.version-1
 AND NEW.root_id=w.root_folder_id AND NEW.settings_id=s.id)) OR
 (NEW.kind='folder' AND NEW.root_id IS NULL AND NEW.settings_id IS NULL AND EXISTS(SELECT 1 FROM folders f
 WHERE f.id=NEW.id AND f.parent_id IS NOT NULL AND f.version=NEW.version-1 AND NEW.scope_key='workspace:'||f.organization_id||':'||f.workspace_id)))
 THEN RAISE(ABORT,'namespace marker binding') END;
END;
DROP TRIGGER namespace_marker_charge;
CREATE TRIGGER namespace_marker_charge AFTER INSERT ON namespace_deletions BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+2048 WHERE id=1;
 UPDATE workspaces SET retired=1,folded_name=char(1)||id WHERE NEW.kind='workspace' AND id=NEW.id;
 DELETE FROM settings WHERE NEW.kind!='workspace' AND id=NEW.settings_id;
 DELETE FROM folders WHERE NEW.kind='folder' AND id=NEW.id;
 DELETE FROM organizations WHERE NEW.kind='organization' AND id=NEW.id;
END;
CREATE TRIGGER workspace_active_insert BEFORE INSERT ON workspaces WHEN NEW.retired!=0 OR substr(NEW.folded_name,1,1)=char(1)
 BEGIN SELECT RAISE(ABORT,'invalid active workspace');END;
CREATE TRIGGER workspace_retired_update BEFORE UPDATE ON workspaces WHEN OLD.retired=1
 BEGIN SELECT RAISE(ABORT,'retained workspace');END;
CREATE TRIGGER workspace_retired_delete BEFORE DELETE ON workspaces WHEN OLD.retired=1
 BEGIN SELECT RAISE(ABORT,'retained workspace');END;
CREATE TRIGGER workspace_retire_binding BEFORE UPDATE OF retired,folded_name ON workspaces WHEN
 (NEW.retired=0 AND substr(NEW.folded_name,1,1)=char(1)) OR (NEW.retired!=OLD.retired AND NOT (
 OLD.retired=0 AND NEW.retired=1 AND NEW.folded_name=char(1)||OLD.id AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id
 AND NEW.root_folder_id=OLD.root_folder_id AND NEW.version=OLD.version AND NEW.name=OLD.name AND EXISTS(
 SELECT 1 FROM namespace_deletions d WHERE d.kind='workspace' AND d.id=OLD.id AND d.version=OLD.version+1
 AND d.root_id=OLD.root_folder_id AND d.scope_key='organization:'||OLD.organization_id)))
 BEGIN SELECT RAISE(ABORT,'workspace retirement requires marker');END;
${['folders','suites','suite_revisions','input_blobs','runs','export_jobs','execution_intents'].map(table => `
CREATE TRIGGER ${table}_retired_workspace BEFORE INSERT ON ${table} WHEN EXISTS(
 SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND w.organization_id=NEW.organization_id AND w.retired=1)
 BEGIN SELECT RAISE(ABORT,'retired workspace');END;`).join('\n')}
CREATE TRIGGER settings_retired_workspace_update BEFORE UPDATE ON settings WHEN OLD.kind='workspace' AND EXISTS(
 SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.organization_id=OLD.organization_id AND w.retired=1)
 BEGIN SELECT RAISE(ABORT,'retained workspace settings');END;
CREATE TRIGGER settings_retired_workspace_delete BEFORE DELETE ON settings WHEN OLD.kind='workspace' AND EXISTS(
 SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.organization_id=OLD.organization_id AND w.retired=1)
 BEGIN SELECT RAISE(ABORT,'retained workspace settings');END;
PRAGMA user_version=28;
`;
