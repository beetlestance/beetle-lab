/** Separate no-task receipt, prepaid by the existing rejected original control. */
export const migration024=`
CREATE TABLE rejected_cleanup_receipts(
 attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
 request_digest TEXT NOT NULL CHECK(typeof(request_digest)='text' AND length(request_digest)=64),
 receipt_identity TEXT NOT NULL UNIQUE CHECK(typeof(receipt_identity)='text' AND length(receipt_identity)=64),
 receipt_json TEXT NOT NULL CHECK(typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=2048 AND json_valid(receipt_json)),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=length(CAST(receipt_json AS BLOB))+512),
 CHECK(request_digest=json_extract(receipt_json,'$.retirementRequestDigest'))
);
CREATE TRIGGER no_task_receipt_insert BEFORE INSERT ON rejected_cleanup_receipts
 WHEN no_task_receipt_insert_allowed(NEW.attempt_id,NEW.receipt_json,NEW.receipt_identity)!=1
 OR EXISTS(SELECT 1 FROM rejected_cleanup_receipts WHERE attempt_id=NEW.attempt_id)
 BEGIN SELECT RAISE(ABORT,'unauthorized no-task receipt'); END;
CREATE TRIGGER no_task_receipt_immutable BEFORE UPDATE ON rejected_cleanup_receipts
 BEGIN SELECT RAISE(ABORT,'immutable no-task receipt'); END;
CREATE TRIGGER no_task_receipt_retained BEFORE DELETE ON rejected_cleanup_receipts
 BEGIN SELECT RAISE(ABORT,'retained no-task receipt'); END;
PRAGMA user_version=24;
`;
