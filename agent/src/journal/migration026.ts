/** Preserve pending rejected receipts verbatim while adding genuine C1 never-started authority. */
export const migration026=`
ALTER TABLE rejected_cleanup_receipts RENAME TO output_no_task_cleanup_receipts;
DROP TRIGGER no_task_receipt_retained;
CREATE TRIGGER no_task_receipt_retained BEFORE DELETE ON output_no_task_cleanup_receipts
 WHEN agent_settlement_delete_allowed(OLD.attempt_id,'output_no_task_cleanup_receipts')!=1
 BEGIN SELECT RAISE(ABORT,'retained no-task receipt'); END;
DROP TRIGGER settlement_rejected_cleanup_receipts_delete;
CREATE TRIGGER settlement_no_task_receipts_delete BEFORE DELETE ON output_no_task_cleanup_receipts
 WHEN agent_settlement_active()=1 AND agent_settlement_delete_allowed(OLD.attempt_id,'output_no_task_cleanup_receipts')!=1
 BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;
PRAGMA user_version=26;
`;
