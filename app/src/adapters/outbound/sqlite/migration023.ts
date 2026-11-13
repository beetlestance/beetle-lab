/** Eligibility index only; stored ACKs remain separate immutable authority. */
export const migration023=`
CREATE INDEX output_deletion_retirable ON output_deletion_intents(sequence) WHERE pending_files=0 AND kind IN ('source','absence');
PRAGMA user_version=23;
`;
