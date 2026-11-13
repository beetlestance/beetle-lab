import { purgeOrder } from './purge-order.js';
const retained=[
 ['output_absence_closures','absence_delete','immutable output absence'],
 ['cancelled_originals','cancelled_originals_no_delete','immutable cancelled original'],
 ['output_cleanup_plans','cleanup_plan_retained','retained cleanup plan'],
 ['output_cleanup_progress','cleanup_progress_retained','retained cleanup progress'],
 ['output_cleanup_receipts','cleanup_receipt_retained','retained cleanup receipt'],
 ['output_delivery_closures','delivery_delete','immutable output delivery'],
 ['disk_holds','disk_hold_delete','immutable disk hold'],
 ['reservations','disk_reservation_delete','immutable disk reservation'],
 ['output_collection_intents','output_intent_delete','immutable output source'],
 ['output_sources','output_source_delete','immutable output source'],
 ['output_retirement_intents','retirement_retained','retained retirement intent'],
 ['runtime_cleanup_associations','runtime_association_retained','retained runtime association'],
 ['task_staging_namespaces','task_namespace_retained','retained task namespace'],
] as const;
/** Existing unconditional guards gain only the exact original/table permit exception. */
export const retainedDeleteGuards=retained.map(([table,name,reason])=>`DROP TRIGGER ${name};
 CREATE TRIGGER ${name} BEFORE DELETE ON ${table} WHEN agent_settlement_delete_allowed(OLD.attempt_id,'${table}')!=1
 BEGIN SELECT RAISE(ABORT,'${reason}'); END;`).join('\n');
/** During settlement deny cross-original/table writes even through nested triggers.
 * Outside the private transaction, original normal event pruning/update policy remains. */
export const settlementIsolation=purgeOrder.flatMap(table=>[
 `CREATE TRIGGER settlement_${table}_insert BEFORE INSERT ON ${table} WHEN agent_settlement_active()=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
 `CREATE TRIGGER settlement_${table}_update BEFORE UPDATE ON ${table} WHEN agent_settlement_active()=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
 `CREATE TRIGGER settlement_${table}_delete BEFORE DELETE ON ${table} WHEN agent_settlement_active()=1
  AND agent_settlement_delete_allowed(OLD.attempt_id,'${table}')!=1
  BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;`,
]).join('\n');

const fixedGlobal=['admission_settings','journal_authority','installed_staging_namespace','export_assignments'] as const;
export const settlementGlobalIsolation=fixedGlobal.flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>
 `CREATE TRIGGER settlement_global_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table}
 WHEN agent_settlement_active()=1 BEGIN SELECT RAISE(ABORT,'settlement global isolation'); END;`)).join('\n');
