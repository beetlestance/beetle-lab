import { cleanupControl } from '../cleanup-control/index.js';
/** Row presence is atomic cleaned metadata, never an independent IO proof or refund. */
export const migration020=`
CREATE TABLE output_cleanup_receipts (
 attempt_id TEXT PRIMARY KEY REFERENCES output_cleanup_plans(attempt_id),
 plan_identity TEXT NOT NULL UNIQUE REFERENCES output_cleanup_plans(plan_identity),
 receipt_identity TEXT NOT NULL UNIQUE CHECK(typeof(receipt_identity)='text' AND length(receipt_identity)=64),
 receipt_json TEXT NOT NULL CHECK(typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=${cleanupControl.receiptBytes}),
 encoded_bytes INTEGER NOT NULL CHECK(typeof(encoded_bytes)='integer' AND encoded_bytes=length(CAST(receipt_json AS BLOB))),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=encoded_bytes+512 AND charged_bytes<=${cleanupControl.receiptBytes+512})
);
CREATE TRIGGER cleanup_receipt_initial BEFORE INSERT ON output_cleanup_receipts BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_cleanup_receipts WHERE attempt_id=NEW.attempt_id)
 OR NOT EXISTS(SELECT 1 FROM output_cleanup_plans p JOIN output_cleanup_progress g ON g.attempt_id=p.attempt_id AND g.plan_identity=p.plan_identity
 WHERE p.attempt_id=NEW.attempt_id AND p.plan_identity=NEW.plan_identity
 AND cleanup_receipt_identity(NEW.receipt_json,p.plan_json,g.progress_json) IS NOT NULL
 AND NEW.receipt_identity=cleanup_receipt_identity(NEW.receipt_json,p.plan_json,g.progress_json))
 THEN RAISE(ABORT,'invalid cleanup receipt initial') END;
END;
CREATE TRIGGER cleanup_receipt_immutable BEFORE UPDATE ON output_cleanup_receipts BEGIN SELECT RAISE(ABORT,'immutable cleanup receipt'); END;
CREATE TRIGGER cleanup_receipt_retained BEFORE DELETE ON output_cleanup_receipts BEGIN SELECT RAISE(ABORT,'retained cleanup receipt'); END;
PRAGMA user_version=20;
`;
