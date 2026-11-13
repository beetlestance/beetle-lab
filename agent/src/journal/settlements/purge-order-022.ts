/** Fixed FK order. The private transaction owns every row; no user-selected table. */
export const purgeOrder022=['output_absence_closures','output_cleanup_receipts','output_cleanup_progress',
 'runtime_cleanup_associations','output_cleanup_plans','output_retirement_intents','output_delivery_closures',
 'output_sources','output_collection_intents','event_spool','supervision_clock','cancelled_originals',
 'admission_queue','task_staging_namespaces','disk_holds','reservations','accepted_attempts'] as const;
