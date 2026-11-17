/**
 * Folder-first suite listing. Each suite stores its latest retained Run (requested time,
 * then Run UUID, both descending) and its display group; SQL triggers maintain them in
 * the same statement transaction as Run insert, state/outcome change and deletion.
 * 'no_revision' is private: it is the public 'no_runs' group of a suite without a
 * revision, kept apart so engine filters stay index-bounded. Revisions count their
 * retained Runs in a separate table because revision rows are immutable.
 */
const group = (alias: string) =>
  `CASE WHEN ${alias}.state IN ('queued','dispatching','active','finalizing') THEN 'in_progress'
 WHEN ${alias}.state='finished' THEN ${alias}.outcome ELSE 'stopped' END`;
const empty = (alias: string) => `CASE WHEN ${alias}.current_revision_id IS NULL THEN 'no_revision' ELSE 'no_runs' END`;
/** The newest retained Run of one suite, through the existing per-suite history index. */
const newest = (column: string, row: string, suite = `${row}.id`) =>
  `(SELECT ${column} FROM runs r INDEXED BY runs_history_suite WHERE r.organization_id=${row}.organization_id
 AND r.workspace_id=${row}.workspace_id AND r.suite_id=${suite} ORDER BY r.requested_at DESC,r.id DESC LIMIT 1)`;
const newestFor = (column: string) => newest(column, 'OLD', 'OLD.suite_id');
const abort = (reason: string) => `BEGIN SELECT RAISE(ABORT,'${reason}');END;`;
/** Settlement purges a Run, so it may move only the derived latest-Run columns of that Run's suite
 * and decrement its revision count; every other suite column stays frozen as before. Retention
 * reservation frames freeze the new count table like every other pre-existing owner. */
const guards = `DROP TRIGGER settlement_suites_update;
CREATE TRIGGER settlement_suites_update BEFORE UPDATE OF
 id,organization_id,workspace_id,folder_id,name,folded_name,version,current_revision_id,description ON suites
 WHEN backend_settlement_active()=1 ${abort('outside settlement ownership')}
CREATE TRIGGER settlement_suites_latest BEFORE UPDATE OF latest_run_id,latest_requested_at,latest_group ON suites
 WHEN backend_settlement_active()=1 AND backend_settlement_delete('runs',OLD.latest_run_id) IS NOT 1
 ${abort('outside settlement ownership')}
CREATE TRIGGER settlement_suite_revision_run_counts_insert BEFORE INSERT ON suite_revision_run_counts
 WHEN backend_settlement_active()=1 ${abort('outside settlement ownership')}
CREATE TRIGGER settlement_suite_revision_run_counts_update BEFORE UPDATE ON suite_revision_run_counts
 WHEN backend_settlement_active()=1 AND (NEW.revision_id IS NOT OLD.revision_id OR NEW.run_count IS NOT OLD.run_count-1)
 ${abort('outside settlement ownership')}
${['insert', 'update', 'delete']
  .map(
    (event) => `CREATE TRIGGER retention_funding_suite_revision_run_counts_${event} BEFORE ${event.toUpperCase()}
 ON suite_revision_run_counts WHEN retention_metadata_active()=1 ${abort('outside retention reservation')}`,
  )
  .join('\n')}`;
export const migration034 = `
ALTER TABLE suites ADD COLUMN latest_run_id TEXT CHECK(latest_run_id IS NULL OR
 (typeof(latest_run_id)='text' AND length(latest_run_id)=36 AND latest_run_id=lower(latest_run_id)));
ALTER TABLE suites ADD COLUMN latest_requested_at TEXT NOT NULL DEFAULT '' CHECK(typeof(latest_requested_at)='text'
 AND length(latest_requested_at) IN (0,24));
ALTER TABLE suites ADD COLUMN latest_group TEXT NOT NULL DEFAULT 'no_revision' CHECK(
 latest_group IN ('in_progress','passed','failed','inconclusive','stopped','no_runs','no_revision')
 AND (latest_run_id IS NULL)=(latest_group IN ('no_runs','no_revision'))
 AND (latest_run_id IS NULL)=(latest_requested_at=''));
UPDATE suites SET latest_group=${empty('suites')};
UPDATE suites SET (latest_run_id,latest_requested_at,latest_group)=
 (${newest('r.id', 'suites')},${newest('r.requested_at', 'suites')},${newest(group('r'), 'suites')})
 WHERE ${newest('1', 'suites')} IS NOT NULL;
CREATE INDEX suites_latest_recent ON suites(organization_id,workspace_id,latest_group,latest_requested_at DESC,id DESC);
CREATE INDEX suites_latest_name ON suites(organization_id,workspace_id,latest_group,folded_name,id);
CREATE INDEX suites_latest_folder_recent ON suites(organization_id,workspace_id,folder_id,latest_group,latest_requested_at DESC,id DESC);
CREATE INDEX suites_latest_folder_name ON suites(organization_id,workspace_id,folder_id,latest_group,folded_name,id);
CREATE TRIGGER suites_latest_revision AFTER UPDATE OF current_revision_id ON suites
 WHEN NEW.latest_run_id IS NULL AND NEW.latest_group IS NOT ${empty('NEW')}
 BEGIN UPDATE suites SET latest_group=${empty('NEW')} WHERE id=NEW.id; END;
CREATE TRIGGER runs_latest_insert AFTER INSERT ON runs BEGIN
 UPDATE suites SET latest_run_id=NEW.id,latest_requested_at=NEW.requested_at,latest_group=${group('NEW')}
 WHERE id=NEW.suite_id AND organization_id=NEW.organization_id AND workspace_id=NEW.workspace_id
 AND (latest_requested_at<NEW.requested_at OR (latest_requested_at=NEW.requested_at AND coalesce(latest_run_id,'')<NEW.id));
END;
CREATE TRIGGER runs_latest_state AFTER UPDATE OF state,outcome ON runs
 WHEN NEW.state IS NOT OLD.state OR NEW.outcome IS NOT OLD.outcome BEGIN
 UPDATE suites SET latest_group=${group('NEW')} WHERE id=NEW.suite_id AND latest_run_id=NEW.id; END;
CREATE TRIGGER runs_latest_delete AFTER DELETE ON runs BEGIN
 UPDATE suites SET latest_run_id=${newestFor('r.id')},
 latest_requested_at=coalesce(${newestFor('r.requested_at')},''),
 latest_group=coalesce(${newestFor(group('r'))},${empty('suites')})
 WHERE id=OLD.suite_id AND latest_run_id=OLD.id; END;
CREATE TABLE suite_revision_run_counts (
 revision_id TEXT PRIMARY KEY CHECK(revision_id=lower(revision_id)),
 run_count INTEGER NOT NULL CHECK(typeof(run_count)='integer' AND run_count BETWEEN 0 AND 9007199254740991),
 FOREIGN KEY(revision_id) REFERENCES suite_revisions(id)) WITHOUT ROWID;
INSERT INTO suite_revision_run_counts SELECT revision_id,count(*) FROM runs GROUP BY revision_id;
INSERT OR IGNORE INTO suite_revision_run_counts SELECT id,0 FROM suite_revisions;
CREATE TRIGGER revisions_run_count_insert AFTER INSERT ON suite_revisions BEGIN
 INSERT INTO suite_revision_run_counts(revision_id,run_count) VALUES(NEW.id,0); END;
CREATE TRIGGER runs_revision_count_insert AFTER INSERT ON runs BEGIN
 UPDATE suite_revision_run_counts SET run_count=run_count+1 WHERE revision_id=NEW.revision_id;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'revision run count') END; END;
CREATE TRIGGER runs_revision_count_delete AFTER DELETE ON runs BEGIN
 UPDATE suite_revision_run_counts SET run_count=run_count-1 WHERE revision_id=OLD.revision_id;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'revision run count') END; END;
CREATE TRIGGER revision_run_count_delete BEFORE DELETE ON suite_revision_run_counts
 BEGIN SELECT RAISE(ABORT,'retained revision run count'); END;
${guards}
PRAGMA user_version=34;
`;
