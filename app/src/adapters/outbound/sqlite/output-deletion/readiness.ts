/** Positive backend admission metadata only; not native absence or refund authority.
 * Rejected originals need their separately funded no-admission cleanup protocol. */
export const admittedDeletion=`(d.kind='source' OR (d.kind='absence' AND EXISTS(
 SELECT 1 FROM execution_output_absences p WHERE p.attempt_id=d.attempt_id
 AND json_extract(p.proof_json,'$.admission.state')='released')))`;
