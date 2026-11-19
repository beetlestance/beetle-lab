/** Derived history cache writes cannot change retention selection or protection.
 * Classify every future runs column in the schema-coverage regression. */
export const migration038 = `
DROP TRIGGER retention_run_update;
CREATE TRIGGER retention_run_update
AFTER UPDATE OF id, organization_id, workspace_id, suite_id, revision_id,
 active_attempt_id, version, state, outcome, validation_status,
 cancellation_requested, reason, requested_at, snapshot_json ON runs
BEGIN
 UPDATE retention_workspace_epochs SET epoch=epoch+1
 WHERE workspace_id=NEW.workspace_id AND organization_id=NEW.organization_id;
END;
PRAGMA user_version=38;
`;
