import { purgeOrder } from './purge-order.js';
const retained:Readonly<Record<string,string>>={
 backend_output_cleanup_acks:'cleanup_ack_retained',output_deletion_files:'output_deletion_file_retained',
 output_deletion_intents:'output_deletion_intent_retained',execution_output_finalizations:'finalization_retained',
 execution_output_absence_finalizations:'absence_receipt_delete',execution_output_absences:'absence_proof_delete',
 execution_output_payloads:'output_payload_retained',execution_output_slots:'output_slot_retained',execution_output_sources:'output_source_retained',
 run_events:'run_event_retained',event_cursors:'event_cursor_retained',attempt_output_allocations:'output_retained',
 execution_records:'execution_record_retained',execution_orders:'execution_order_retained',backend_cleanup_controls:'cleanup_control_retained',
 execution_intents:'execution_intent_retained',
};
const unchanged=['export_absences','export_artifacts','export_input_pins','export_jobs','export_originals','export_sources',
 'folders','history_name_grams','history_name_progress','input_blobs','local_browser_session','organizations','receipts',
 'revision_input_pins','settings','suite_revisions','suites','workspaces'];
/** Existing conditional active/delivery guards remain intact. No old migration literals change. */
export const settlementGuards=purgeOrder.map(([table,column])=>{
 const trigger=retained[table];const exception=`backend_settlement_delete('${table}',OLD.${column}) IS NOT 1`;
 const retain=trigger?`DROP TRIGGER ${trigger};CREATE TRIGGER ${trigger} BEFORE DELETE ON ${table} WHEN ${exception}
 BEGIN SELECT RAISE(ABORT,'retained settlement original');END;`:'';
 return`${retain}
 CREATE TRIGGER settlement_${table}_delete BEFORE DELETE ON ${table} WHEN backend_settlement_active()=1 AND ${exception}
 BEGIN SELECT RAISE(ABORT,'different settlement original');END;
 ${['INSERT','UPDATE'].map(event=>`CREATE TRIGGER settlement_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table}
 WHEN backend_settlement_active()=1 BEGIN SELECT RAISE(ABORT,'settlement original immutable');END;`).join('\n')}`;
}).join('\n')+unchanged.map(table=>['INSERT','UPDATE','DELETE'].map(event=>
 `CREATE TRIGGER settlement_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} WHEN backend_settlement_active()=1
 BEGIN SELECT RAISE(ABORT,'outside settlement ownership');END;`).join('\n')).join('\n');
