/** One installation-private browser credential; no public metadata reader. */
export const localBrowserSessionSchema = `
CREATE TABLE local_browser_session (
 id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 session_json TEXT CHECK(session_json IS NULL OR (typeof(session_json)='text' AND length(CAST(session_json AS BLOB))<=1024 AND json_valid(session_json))));
CREATE TRIGGER local_browser_session_update BEFORE UPDATE ON local_browser_session BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.version!=OLD.version+1 THEN RAISE(ABORT,'monotonic local credential') END;
END;
`;
export const migration014 = localBrowserSessionSchema + 'PRAGMA user_version=14;\n';
