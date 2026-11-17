import { namespaceProtectionSql } from './namespace-deletion/protection.js';
import { workspaceBusySql } from './workspace-retirement/visibility.js';
/**
 * Organisation retirement. An organisation whose workspaces are all retired is retired
 * instead of deleted: FK-linked originals and its settings stay; only public visibility
 * and the private slug key change, so a new organisation may reuse the slug.
 * Migration 028 text stays unchanged; this step replaces its two marker triggers.
 */
const activeWorkspace =
  'EXISTS(SELECT 1 FROM workspaces INDEXED BY workspaces_visible WHERE retired=0 AND organization_id=target.id LIMIT 1)';
const retiredOrganization = (column: string) =>
  `EXISTS(SELECT 1 FROM organizations o WHERE o.id=${column} AND o.retired=1)`;
export const migration030 = `
ALTER TABLE organizations ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1));
ALTER TABLE organizations ADD COLUMN retired_slug TEXT CHECK(retired_slug IS NULL OR length(CAST(retired_slug AS BLOB))<=128);
CREATE INDEX organizations_visible ON organizations(id) WHERE retired=0;
DROP TRIGGER namespace_marker_binding;
CREATE TRIGGER namespace_marker_binding BEFORE INSERT ON namespace_deletions BEGIN
 SELECT CASE WHEN NEW.kind='organization' AND EXISTS(SELECT 1 FROM organizations target WHERE target.id=NEW.id AND (${activeWorkspace}))
 THEN RAISE(ABORT,'namespace not empty') END;
 SELECT CASE WHEN NEW.kind='folder' AND EXISTS(SELECT 1 FROM folders target WHERE target.id=NEW.id AND (${namespaceProtectionSql('folder')}))
 THEN RAISE(ABORT,'namespace not empty') END;
 SELECT CASE WHEN NEW.kind='workspace' AND EXISTS(SELECT 1 FROM workspaces target WHERE target.id=NEW.id AND (${workspaceBusySql}))
 THEN RAISE(ABORT,'workspace has unfinished work') END;
 SELECT CASE WHEN NOT (
 (NEW.kind='organization' AND NEW.scope_key='installation' AND NEW.root_id IS NULL AND EXISTS(
 SELECT 1 FROM organizations o JOIN settings s ON s.scope_key='organization:'||o.id WHERE o.id=NEW.id AND o.retired=0
 AND o.version=NEW.version-1 AND s.id=NEW.settings_id)) OR
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
 UPDATE organizations SET retired=1,retired_slug=slug,slug=char(1)||id WHERE NEW.kind='organization' AND id=NEW.id
  AND EXISTS(SELECT 1 FROM workspaces WHERE organization_id=NEW.id);
 DELETE FROM settings WHERE NEW.kind!='workspace' AND id=NEW.settings_id AND NOT ${retiredOrganization('NEW.id')};
 DELETE FROM folders WHERE NEW.kind='folder' AND id=NEW.id;
 DELETE FROM organizations WHERE NEW.kind='organization' AND id=NEW.id AND retired=0;
END;
CREATE TRIGGER organization_active_insert BEFORE INSERT ON organizations
 WHEN NEW.retired!=0 OR NEW.retired_slug IS NOT NULL OR substr(NEW.slug,1,1)=char(1)
 BEGIN SELECT RAISE(ABORT,'invalid active organization');END;
CREATE TRIGGER organization_retired_update BEFORE UPDATE ON organizations WHEN OLD.retired=1
 BEGIN SELECT RAISE(ABORT,'retained organization');END;
CREATE TRIGGER organization_retired_delete BEFORE DELETE ON organizations WHEN OLD.retired=1
 BEGIN SELECT RAISE(ABORT,'retained organization');END;
CREATE TRIGGER organization_retire_binding BEFORE UPDATE OF retired,slug,retired_slug ON organizations WHEN
 (NEW.retired=0 AND (NEW.retired_slug IS NOT NULL OR substr(NEW.slug,1,1)=char(1))) OR (NEW.retired!=OLD.retired AND NOT (
 OLD.retired=0 AND NEW.retired=1 AND NEW.slug=char(1)||OLD.id AND NEW.retired_slug=OLD.slug AND NEW.id=OLD.id
 AND NEW.version=OLD.version AND NEW.name=OLD.name
 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.organization_id=OLD.id AND w.retired=0)
 AND EXISTS(SELECT 1 FROM namespace_deletions d WHERE d.kind='organization' AND d.id=OLD.id AND d.version=OLD.version+1
 AND d.scope_key='installation')))
 BEGIN SELECT RAISE(ABORT,'organization retirement requires marker');END;
CREATE TRIGGER workspaces_retired_organization BEFORE INSERT ON workspaces WHEN ${retiredOrganization('NEW.organization_id')}
 BEGIN SELECT RAISE(ABORT,'retired organization');END;
CREATE TRIGGER settings_retired_organization_insert BEFORE INSERT ON settings
 WHEN NEW.organization_id IS NOT NULL AND ${retiredOrganization('NEW.organization_id')}
 BEGIN SELECT RAISE(ABORT,'retired organization');END;
CREATE TRIGGER settings_retired_organization_update BEFORE UPDATE ON settings
 WHEN OLD.organization_id IS NOT NULL AND ${retiredOrganization('OLD.organization_id')}
 BEGIN SELECT RAISE(ABORT,'retained organization settings');END;
CREATE TRIGGER settings_retired_organization_delete BEFORE DELETE ON settings
 WHEN OLD.organization_id IS NOT NULL AND ${retiredOrganization('OLD.organization_id')}
 BEGIN SELECT RAISE(ABORT,'retained organization settings');END;
PRAGMA user_version=30;
`;
