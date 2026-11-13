const tables=['rejected_cleanup_receipts','rejected_cleanup_controls'] as const;
const retained=tables.map(table=>{
 const name=table==='rejected_cleanup_receipts'?'no_task_receipt_retained':'rejected_control_retained';
 return `DROP TRIGGER ${name};CREATE TRIGGER ${name} BEFORE DELETE ON ${table}
 WHEN agent_settlement_delete_allowed(OLD.attempt_id,'${table}')!=1
 BEGIN SELECT RAISE(ABORT,'retained rejected cleanup'); END;`;
}).join('\n');
function insertPermit(table:typeof tables[number]):string{
 return table==='rejected_cleanup_controls'?"rejected_control_insert_allowed(NEW.attempt_id,NEW.control_json)":
  "no_task_receipt_insert_allowed(NEW.attempt_id,NEW.receipt_json,NEW.receipt_identity)";
}
const isolation=tables.flatMap(table=>[
 `CREATE TRIGGER settlement_${table}_insert BEFORE INSERT ON ${table} WHEN agent_settlement_active()=1 AND ${insertPermit(table)}!=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
 `CREATE TRIGGER settlement_${table}_update BEFORE UPDATE ON ${table} WHEN agent_settlement_active()=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
 `CREATE TRIGGER settlement_${table}_delete BEFORE DELETE ON ${table} WHEN agent_settlement_active()=1
  AND agent_settlement_delete_allowed(OLD.attempt_id,'${table}')!=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
]).join('\n');
/** The permanent floor was prepaid: exact temporary-control transfer, no hold refund or backfill. */
export const migration025=`
${retained}
${isolation}
DROP TRIGGER rejected_stats_update;
CREATE TRIGGER rejected_stats_update BEFORE UPDATE ON rejected_cleanup_storage
 WHEN rejected_control_stats_allowed(json_array(OLD.original_count,OLD.charged_bytes,OLD.last_clock),
 json_array(NEW.original_count,NEW.charged_bytes,NEW.last_clock))!=1
 AND agent_settlement_rejected_stats_allowed(json_array(OLD.original_count,OLD.charged_bytes,OLD.last_clock),
 json_array(NEW.original_count,NEW.charged_bytes,NEW.last_clock))!=1
 BEGIN SELECT RAISE(ABORT,'unauthorized rejected cleanup counter'); END;
CREATE TRIGGER rejected_settlement_release AFTER DELETE ON rejected_cleanup_controls BEGIN
 UPDATE rejected_cleanup_storage SET original_count=original_count-1,charged_bytes=charged_bytes-16384 WHERE id=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'missing rejected cleanup counter') END;
END;
PRAGMA user_version=25;
`;
