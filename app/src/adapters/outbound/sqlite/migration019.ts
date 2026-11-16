/** Current names are indexed once; historical Runs never change on a rename. */
function nameTriggers(table: 'folders' | 'suites', kind: string): string {
  const insert = `INSERT OR IGNORE INTO history_name_grams
    SELECT NEW.organization_id,NEW.workspace_id,'${kind}',NEW.id,value
    FROM json_each(history_search_terms(NEW.folded_name));`;
  return `CREATE TRIGGER ${table}_history_insert AFTER INSERT ON ${table} BEGIN ${insert} END;
    CREATE TRIGGER ${table}_history_rename AFTER UPDATE OF folded_name ON ${table}
    WHEN NEW.folded_name IS NOT OLD.folded_name BEGIN
      DELETE FROM history_name_grams WHERE organization_id=OLD.organization_id AND workspace_id=OLD.workspace_id
        AND kind='${kind}' AND entity_id=OLD.id; ${insert} END;
    CREATE TRIGGER ${table}_history_delete AFTER DELETE ON ${table} BEGIN
      DELETE FROM history_name_grams WHERE organization_id=OLD.organization_id AND workspace_id=OLD.workspace_id
        AND kind='${kind}' AND entity_id=OLD.id; END;`;
}
export const migration019 = `
CREATE TABLE history_name_grams (
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('folder','suite')),
 entity_id TEXT NOT NULL, term TEXT NOT NULL CHECK(length(term)=3),
 PRIMARY KEY(organization_id,workspace_id,term,kind,entity_id),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id) ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX history_name_owner ON history_name_grams(organization_id,workspace_id,kind,entity_id,term);
CREATE TABLE history_name_progress (
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, folder_after TEXT NOT NULL DEFAULT '',
 suite_after TEXT NOT NULL DEFAULT '', folders_done INTEGER NOT NULL DEFAULT 0 CHECK(folders_done IN (0,1)),
 suites_done INTEGER NOT NULL DEFAULT 0 CHECK(suites_done IN (0,1)),
 PRIMARY KEY(organization_id,workspace_id),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id) ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX suites_history_folder ON suites(organization_id,workspace_id,folder_id,id);
CREATE INDEX runs_history_suite ON runs(organization_id,workspace_id,suite_id,requested_at DESC,id DESC);
CREATE INDEX runs_history_suite_state ON runs(organization_id,workspace_id,suite_id,state,requested_at DESC,id DESC);
CREATE INDEX runs_history_suite_outcome ON runs(organization_id,workspace_id,suite_id,outcome,requested_at DESC,id DESC);
CREATE INDEX runs_history_suite_state_outcome ON runs(organization_id,workspace_id,suite_id,state,outcome,requested_at DESC,id DESC);
${nameTriggers('folders', 'folder')}
${nameTriggers('suites', 'suite')}
PRAGMA user_version=19;
`;
