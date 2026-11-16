/** Positive retained witnesses after receipt-first cancellation removed the outbox.
 * Alias a is the scoped active attempt; runtime and migration share this rule. */
export const unsentWitness = `a.foundation_owned=1 AND a.execution_intent_id=a.id
 AND a.generation IS NULL AND a.state='offered'
 AND EXISTS(SELECT 1 FROM execution_intents i WHERE i.attempt_id=a.id AND i.run_id=a.run_id
   AND i.organization_id=a.organization_id AND i.workspace_id=a.workspace_id AND i.intent_digest=a.intent_digest)
 AND (SELECT count(*) FROM (SELECT id FROM attempts b WHERE b.run_id=a.run_id
   AND b.organization_id=a.organization_id AND b.workspace_id=a.workspace_id LIMIT 2))=1
 AND EXISTS(SELECT 1 FROM runs r WHERE r.id=a.run_id AND r.active_attempt_id=a.id
   AND r.state='cancelled' AND r.cancellation_requested=1 AND r.reason='cancelled')
 AND NOT EXISTS(SELECT 1 FROM execution_records WHERE attempt_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM attempt_output_allocations WHERE attempt_id=a.id)`;
