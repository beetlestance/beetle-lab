/** Positive backend admission metadata only; not native absence or refund authority.
 * Both released and rejected absence still require exact agent cleanup/settlement proof. */
export const agentRetirementReady=`(d.kind='source' OR (d.kind='absence' AND EXISTS(
 SELECT 1 FROM execution_output_absences p WHERE p.attempt_id=d.attempt_id
 AND json_extract(p.proof_json,'$.admission.state') IN ('released','rejected'))))`;
