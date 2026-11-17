// Frozen projections for migrations 011/014. Serving reads use bounded columns.
export const executionPurposeColumn = 'execution_purpose';
export const cleanupControlColumns = 'cleanup_control_version, cleanup_control_bytes, staging_namespace_identity';
export const metadataColumns = `id, attempt_id, organization_id, workspace_id, intent_digest, generation,
  state, last_seq, cancel_requested, retained_start_seq, acknowledged_seq, spool_bytes,
  spool_rows, quota_bytes, wrapper_high, supervisor_high, wrapper_expired, supervisor_expired,
  phase, exit_json, snapshot_bytes, checkpoint_bytes`;
export const exportResultColumn = `CASE WHEN length(CAST(export_result_json AS BLOB))<=8192 THEN export_result_json ELSE NULL END AS export_result_json`;
export const columns = `${metadataColumns}, ${executionPurposeColumn}, hold_bytes, collection_bytes, source_bytes, delivery_bytes, delivery_pending, absence_bytes, absence_pending, ${cleanupControlColumns},
  ${exportResultColumn},
  CASE WHEN length(CAST(result_json AS BLOB))<=65536 THEN result_json ELSE NULL END AS result_json,
  CASE WHEN length(CAST(exit_facts_json AS BLOB))<=1024 THEN exit_facts_json ELSE NULL END AS exit_facts_json,
  CASE WHEN length(CAST(wrapper_checkpoint_json AS BLOB))<=1024 THEN wrapper_checkpoint_json ELSE NULL END AS wrapper_checkpoint_json`;
