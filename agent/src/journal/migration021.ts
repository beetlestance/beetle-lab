/** Explicit2048-byte cell inside already reserved C1 control capacity; no new charge. */
export const migration021=`
CREATE TABLE runtime_cleanup_associations(
 attempt_id TEXT PRIMARY KEY REFERENCES output_retirement_intents(attempt_id),
 association_json TEXT NOT NULL CHECK(typeof(association_json)='text' AND length(CAST(association_json AS BLOB))<=1536),
 encoded_bytes INTEGER NOT NULL CHECK(typeof(encoded_bytes)='integer' AND encoded_bytes=length(CAST(association_json AS BLOB))),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=encoded_bytes+512 AND charged_bytes<=2048)
);
CREATE TRIGGER runtime_association_initial BEFORE INSERT ON runtime_cleanup_associations BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM runtime_cleanup_associations WHERE attempt_id=NEW.attempt_id)
 OR NOT EXISTS(SELECT 1 FROM output_retirement_intents r JOIN accepted_attempts a ON a.attempt_id=r.attempt_id
 JOIN reservations q ON q.attempt_id=r.attempt_id
 JOIN installed_staging_namespace n ON n.id=1 AND n.state='bound'
 JOIN task_staging_namespaces t ON t.attempt_id=r.attempt_id AND t.state='prepared' WHERE r.attempt_id=NEW.attempt_id AND q.charged=0
 AND a.cleanup_control_version=1 AND a.cleanup_control_bytes=196608 AND a.staging_namespace_identity=r.namespace_identity
 AND runtime_association_matches(NEW.association_json,r.intent_json,q.reservation_json,n.intent_json,t.intent_json)=1)
 THEN RAISE(ABORT,'invalid runtime association') END;
END;
CREATE TRIGGER runtime_association_immutable BEFORE UPDATE ON runtime_cleanup_associations BEGIN SELECT RAISE(ABORT,'immutable runtime association');END;
CREATE TRIGGER runtime_association_retained BEFORE DELETE ON runtime_cleanup_associations BEGIN SELECT RAISE(ABORT,'retained runtime association');END;
PRAGMA user_version=21;
`;
