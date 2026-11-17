/** Name text rules: scalar bound plus a four-byte-per-scalar UTF-8 ceiling. */
function text(column: string, scalars: number): string {
  return `${column} IS NULL OR (typeof(${column})='text' AND length(${column}) BETWEEN 1 AND ${scalars}
  AND length(CAST(${column} AS BLOB))<=${scalars * 4})`;
}
const noteTerms = `SELECT NEW.organization_id,NEW.workspace_id,NEW.run_id,value
  FROM json_each(CASE WHEN NEW.note IS NULL THEN '[]' ELSE history_search_terms(NEW.note) END)`;
/**
 * Authoring metadata. Existing suites and revisions keep NULL (never fabricated);
 * revisions stay immutable, so their metadata is fixed at insert. Run notes live
 * beside the immutable Run intent with their own version and same-transaction
 * trigram postings; every note postdates this step, so no backfill exists.
 * Runtime start/exit events gain a partial index for bounded Run read derivation.
 */
export const migration031 = `
ALTER TABLE suites ADD COLUMN description TEXT CHECK(${text('description', 280)});
ALTER TABLE suite_revisions ADD COLUMN saved_at TEXT CHECK(saved_at IS NULL OR (typeof(saved_at)='text' AND length(saved_at) BETWEEN 20 AND 40));
ALTER TABLE suite_revisions ADD COLUMN message TEXT CHECK(${text('message', 280)});
ALTER TABLE suite_revisions ADD COLUMN saved_by TEXT CHECK(${text('saved_by', 128)});
CREATE TRIGGER revisions_metadata_insert BEFORE INSERT ON suite_revisions
 WHEN (NEW.saved_at IS NULL)!=(NEW.saved_by IS NULL) OR (NEW.message IS NOT NULL AND NEW.saved_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'revision metadata is recorded together'); END;
CREATE TABLE run_notes (
 run_id TEXT PRIMARY KEY CHECK(run_id=lower(run_id)), organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 note TEXT CHECK(${text('note', 1000)}),
 FOREIGN KEY(run_id,organization_id,workspace_id) REFERENCES runs(id,organization_id,workspace_id)) WITHOUT ROWID;
CREATE TRIGGER run_notes_first BEFORE INSERT ON run_notes WHEN NEW.version!=1
 BEGIN SELECT RAISE(ABORT,'run note starts at version 1'); END;
CREATE TRIGGER run_notes_next BEFORE UPDATE ON run_notes WHEN NEW.run_id IS NOT OLD.run_id
 OR NEW.organization_id IS NOT OLD.organization_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.version!=OLD.version+1
 BEGIN SELECT RAISE(ABORT,'run note version'); END;
CREATE TRIGGER run_notes_retained BEFORE DELETE ON run_notes BEGIN SELECT RAISE(ABORT,'retained run note'); END;
CREATE TABLE history_note_grams (
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, term TEXT NOT NULL CHECK(length(term)=3),
 PRIMARY KEY(organization_id,workspace_id,term,run_id),
 FOREIGN KEY(run_id) REFERENCES run_notes(run_id)) WITHOUT ROWID;
CREATE INDEX history_note_owner ON history_note_grams(run_id,term);
CREATE TRIGGER run_notes_history_insert AFTER INSERT ON run_notes BEGIN
 INSERT OR IGNORE INTO history_note_grams ${noteTerms}; END;
CREATE TRIGGER run_notes_history_update AFTER UPDATE OF note ON run_notes WHEN NEW.note IS NOT OLD.note BEGIN
 DELETE FROM history_note_grams WHERE run_id=OLD.run_id;
 INSERT OR IGNORE INTO history_note_grams ${noteTerms}; END;
CREATE INDEX run_events_runtime ON run_events(attempt_id,generation,seq)
 WHERE json_extract(canonical_json,'$.kind') IN ('runtime.started','runtime.exited');
PRAGMA user_version=31;
`;
