/**
 * Run pins. One row per pinned terminal run, at most 256 per workspace. The guards
 * repeat the adapter checks so no later writer can pin an active or admitted run, or
 * admit removal of a pinned one. Pins stay with a retired workspace's retained rows.
 * Insert and delete advance the workspace retention epoch, so a preview goes stale.
 */
const uuid = (column: string) => `length(${column})=36 AND ${column}=lower(${column})`;
const retired = (alias: string) =>
  `EXISTS(SELECT 1 FROM workspaces w WHERE w.id=${alias}.workspace_id AND w.organization_id=${alias}.organization_id AND w.retired!=0)`;
export const RUN_PIN_LIMIT = 256;
export const migration033 = `
CREATE TABLE run_pins (
 run_id TEXT PRIMARY KEY CHECK(${uuid('run_id')}),
 organization_id TEXT NOT NULL CHECK(${uuid('organization_id')}),
 workspace_id TEXT NOT NULL CHECK(${uuid('workspace_id')}),
 pinned_at TEXT NOT NULL CHECK(length(pinned_at)=24),
 request_id TEXT NOT NULL CHECK(${uuid('request_id')}),
 FOREIGN KEY(run_id,organization_id,workspace_id) REFERENCES runs(id,organization_id,workspace_id));
CREATE INDEX run_pins_workspace ON run_pins(organization_id,workspace_id,run_id);
CREATE TRIGGER run_pin_insert BEFORE INSERT ON run_pins BEGIN
 SELECT CASE WHEN retention_metadata_active()=1 OR ${retired('NEW')} THEN RAISE(ABORT,'run pin outside public mutation') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=NEW.run_id AND r.organization_id=NEW.organization_id
  AND r.workspace_id=NEW.workspace_id AND r.state IN ('finished','cancelled','errored') AND r.outcome!='pending')
 THEN RAISE(ABORT,'run pin requires terminal run') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_deletion_intents WHERE run_id=NEW.run_id)
 THEN RAISE(ABORT,'run pin after removal admission') END;
 SELECT CASE WHEN (SELECT count(*) FROM (SELECT 1 FROM run_pins INDEXED BY run_pins_workspace
  WHERE organization_id=NEW.organization_id AND workspace_id=NEW.workspace_id LIMIT ${RUN_PIN_LIMIT}))>=${RUN_PIN_LIMIT}
 THEN RAISE(ABORT,'run pin limit') END;
END;
CREATE TRIGGER run_pin_update BEFORE UPDATE ON run_pins BEGIN SELECT RAISE(ABORT,'immutable run pin');END;
CREATE TRIGGER run_pin_delete BEFORE DELETE ON run_pins WHEN retention_metadata_active()=1 OR ${retired('OLD')}
 BEGIN SELECT RAISE(ABORT,'retained run pin');END;
CREATE TRIGGER run_pin_epoch_insert AFTER INSERT ON run_pins BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1
 WHERE workspace_id=NEW.workspace_id AND organization_id=NEW.organization_id;END;
CREATE TRIGGER run_pin_epoch_delete AFTER DELETE ON run_pins BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1
 WHERE workspace_id=OLD.workspace_id AND organization_id=OLD.organization_id;END;
CREATE TRIGGER run_pin_removal_guard BEFORE INSERT ON output_deletion_intents
 WHEN EXISTS(SELECT 1 FROM run_pins WHERE run_id=NEW.run_id) BEGIN SELECT RAISE(ABORT,'pinned run');END;
PRAGMA user_version=33;
`;
