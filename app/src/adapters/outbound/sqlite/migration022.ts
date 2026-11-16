/** One bounded immutable receipt in the separately reserved backend ACK bucket. */
export const migration022=`
CREATE TABLE backend_output_cleanup_acks (
 deletion_id TEXT PRIMARY KEY CHECK(length(CAST(deletion_id AS BLOB))=36 AND deletion_id=lower(deletion_id)),
 version INTEGER NOT NULL CHECK(version=1),
 body_json TEXT NOT NULL CHECK(typeof(body_json)='text' AND length(CAST(body_json AS BLOB))<=4096 AND json_valid(body_json)),
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64 AND reply_digest NOT GLOB '*[^0-9a-f]*'),
 logical_bytes INTEGER NOT NULL CHECK(typeof(logical_bytes)='integer' AND logical_bytes=length(CAST(body_json AS BLOB))+512 AND logical_bytes<=4608),
 FOREIGN KEY(deletion_id) REFERENCES output_deletion_intents(id));
CREATE TRIGGER cleanup_ack_insert BEFORE INSERT ON backend_output_cleanup_acks BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM backend_output_cleanup_acks WHERE deletion_id=NEW.deletion_id)
 OR backend_cleanup_ack_authorized(NEW.deletion_id,NEW.body_json,NEW.reply_digest,NEW.logical_bytes) IS NOT 1
 THEN RAISE(ABORT,'cleanup ACK requires validated transaction') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM output_deletion_intents d JOIN backend_cleanup_controls c ON c.attempt_id=d.attempt_id
 WHERE d.id=NEW.deletion_id AND d.kind IN ('source','absence') AND d.pending_files=0
 AND c.run_id=d.run_id AND c.organization_id=d.organization_id AND c.workspace_id=d.workspace_id AND c.policy_version=1
 AND (SELECT count(*) FROM output_deletion_files WHERE deletion_id=d.id)=d.file_count
 AND NOT EXISTS(SELECT 1 FROM output_deletion_files WHERE deletion_id=d.id AND (absent<>1 OR version<>3)))
 THEN RAISE(ABORT,'cleanup ACK requires committed file custody') END; END;
CREATE TRIGGER cleanup_ack_immutable BEFORE UPDATE ON backend_output_cleanup_acks BEGIN SELECT RAISE(ABORT,'immutable cleanup ACK'); END;
CREATE TRIGGER cleanup_ack_retained BEFORE DELETE ON backend_output_cleanup_acks BEGIN SELECT RAISE(ABORT,'retained cleanup ACK'); END;
PRAGMA user_version=22;
`;
