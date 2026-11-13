import { asSchema16 } from '../retirement/legacy.js';
import type { DatabaseSync } from 'node:sqlite';
/** Recreate actual predecessor schema only in a task-owned fixture; retain all pre-C1 data. */
export function asSchema15(db: DatabaseSync): void {
  if ([17,18,19].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) asSchema16(db);
  for (const name of ['installed_namespace_initial', 'installed_namespace_immutable', 'installed_namespace_retained',
    'cleanup_control_initial', 'cleanup_control_budget', 'cleanup_control_before_admission',
    'task_namespace_initial', 'task_namespace_immutable', 'task_namespace_retained']) db.exec('DROP TRIGGER ' + name);
  db.exec(`DROP TABLE task_staging_namespaces;
    ALTER TABLE accepted_attempts DROP COLUMN cleanup_control_bytes;
    ALTER TABLE accepted_attempts DROP COLUMN cleanup_control_version;
    ALTER TABLE accepted_attempts DROP COLUMN staging_namespace_identity;
    DROP TABLE installed_staging_namespace;
    PRAGMA user_version=15;`);
}
