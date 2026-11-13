import { cleanupControl } from '../cleanup-control/index.js';
/** Bounded monotonic metadata; no native proof or quota release. */
export const migration019=`
CREATE TABLE output_cleanup_progress (
 attempt_id TEXT PRIMARY KEY REFERENCES output_cleanup_plans(attempt_id),
 plan_identity TEXT NOT NULL UNIQUE REFERENCES output_cleanup_plans(plan_identity),
 progress_json TEXT NOT NULL CHECK(typeof(progress_json)='text' AND length(CAST(progress_json AS BLOB))<=${cleanupControl.progressBytes}),
 encoded_bytes INTEGER NOT NULL CHECK(typeof(encoded_bytes)='integer' AND encoded_bytes=length(CAST(progress_json AS BLOB))),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=encoded_bytes+512 AND charged_bytes<=${cleanupControl.progressBytes+512})
);
CREATE TRIGGER cleanup_progress_initial BEFORE INSERT ON output_cleanup_progress BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_cleanup_progress WHERE attempt_id=NEW.attempt_id)
 OR NOT EXISTS(SELECT 1 FROM output_cleanup_plans p WHERE p.attempt_id=NEW.attempt_id AND p.plan_identity=NEW.plan_identity
 AND cleanup_progress_initial(NEW.progress_json,p.plan_json)=1)
 THEN RAISE(ABORT,'invalid cleanup progress initial') END;
END;
CREATE TRIGGER cleanup_progress_update BEFORE UPDATE ON output_cleanup_progress BEGIN
 SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.plan_identity IS NOT OLD.plan_identity
 OR NOT EXISTS(SELECT 1 FROM output_cleanup_plans p WHERE p.attempt_id=OLD.attempt_id AND p.plan_identity=OLD.plan_identity
 AND cleanup_progress_next(OLD.progress_json,NEW.progress_json,p.plan_json)=1)
 THEN RAISE(ABORT,'invalid cleanup progress transition') END;
END;
CREATE TRIGGER cleanup_progress_retained BEFORE DELETE ON output_cleanup_progress BEGIN SELECT RAISE(ABORT,'retained cleanup progress'); END;
PRAGMA user_version=19;
`;
