import { EVENT_MAX_RETAINED_ROWS } from '../../../../ports/events.js';
/** Exact original keys; deferred cyclic FKs remain enforced at COMMIT. */
export const purgeOrder=[
 ['backend_output_cleanup_acks','deletion_id','deletion',1],
 ['output_deletion_files','deletion_id','deletion',128],
 ['output_deletion_intents','id','deletion',1],
 ['execution_output_finalizations','attempt_id','attempt',1],
 ['execution_output_absence_finalizations','attempt_id','attempt',1],
 ['execution_output_absences','attempt_id','attempt',1],
 ['execution_output_payloads','attempt_id','attempt',1],
 ['execution_output_slots','attempt_id','attempt',128],
 ['execution_output_sources','attempt_id','attempt',1],
 ['run_events','attempt_id','attempt',EVENT_MAX_RETAINED_ROWS],
 ['event_cursors','attempt_id','attempt',1],
 ['attempt_output_allocations','attempt_id','attempt',1],
 ['execution_records','attempt_id','attempt',1],
 ['dispatch_outbox','attempt_id','attempt',0],
 ['execution_orders','attempt_id','attempt',1],
 ['backend_cleanup_controls','attempt_id','attempt',1],
 ['attempts','id','attempt',1],
 ['execution_intents','attempt_id','attempt',1],
 ['runs','id','run',1],
] as const;
export type PurgeTable=typeof purgeOrder[number][0];
export interface OriginalIds {readonly deletion:string;readonly attempt:string;readonly run:string}
