import type { DatabaseSync } from 'node:sqlite';
import { METADATA_SCHEMA_VERSION } from '../schema.js';
import { StorageError } from '../protocol.js';
const named = [
  ['runs', "SELECT 1 FROM runs WHERE state NOT IN ('finished','cancelled','errored') LIMIT 1"],
  [
    'exports',
    "SELECT 1 FROM export_jobs WHERE state NOT IN ('ready','failed','cancelled') OR execution_charged!=0 LIMIT 1",
  ],
  ['executions', 'SELECT 1 FROM execution_records WHERE execution_charged!=0 OR event_pending!=0 LIMIT 1'],
  ['dispatch_outbox', 'SELECT 1 FROM dispatch_outbox LIMIT 1'],
  ['input_uploads', "SELECT 1 FROM input_blobs WHERE state IN ('staging','publishing','deleting') LIMIT 1"],
  ['output_deletions', 'SELECT 1 FROM output_deletion_intents WHERE pending_files!=0 LIMIT 1'],
  [
    'output_sources',
    'SELECT 1 FROM execution_output_sources s WHERE NOT EXISTS(SELECT 1 FROM execution_output_finalizations f WHERE f.attempt_id=s.attempt_id) LIMIT 1',
  ],
  ['output_slots', "SELECT 1 FROM execution_output_slots s WHERE json_extract(s.slot_json,'$.p')!='published' LIMIT 1"],
  ['attempt_ownership', 'SELECT 1 FROM attempts WHERE foundation_owned!=1 AND generation IS NOT NULL LIMIT 1'],
] as const;
/** Oldest metadata schema an offline upgrade accepts (the declared predecessor release). */
export const METADATA_UPGRADE_SOURCE_VERSION = 29;
export { METADATA_SCHEMA_VERSION };
function installationSchema(db: DatabaseSync, installationId: string): number {
  if (db.prepare('PRAGMA query_only').get()?.query_only !== 1) throw new StorageError('unavailable');
  const schema = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  const row = db
    .prepare(
      "SELECT CASE WHEN length(CAST(id AS BLOB))=36 THEN id END id FROM settings WHERE scope_key='installation' LIMIT 2",
    )
    .all();
  if (row.length !== 1 || row[0]?.id !== installationId) throw new StorageError('conflict');
  return schema;
}
/** Offline caller owns both startup leases and the read-only connection. No repair/refund. */
export function inspectColdMetadata(db: DatabaseSync, installationId: string) {
  if (db.prepare('PRAGMA query_only').get()?.query_only !== 1) throw new StorageError('unavailable');
  if (db.prepare('PRAGMA user_version').get()?.user_version !== METADATA_SCHEMA_VERSION)
    throw new StorageError('unavailable');
  installationSchema(db, installationId);
  for (const [, sql] of named) if (db.prepare(sql).get()) throw new StorageError('conflict');
  return Object.freeze({ schema: METADATA_SCHEMA_VERSION, installationId, quiescence: 'cold-terminal-only' as const });
}
/**
 * Upgrade preflight: accepts the predecessor or current schema and names every
 * unfinished category instead of stopping at the first. Read-only; never migrates.
 */
export function inspectColdMetadataForUpgrade(db: DatabaseSync, installationId: string) {
  const schema = installationSchema(db, installationId);
  if (!Number.isSafeInteger(schema) || schema < METADATA_UPGRADE_SOURCE_VERSION || schema > METADATA_SCHEMA_VERSION)
    throw new StorageError('unavailable');
  const blockers = named.filter(([, sql]) => db.prepare(sql).get() !== undefined).map(([name]) => name);
  return Object.freeze({ schema, installationId, blockers: Object.freeze(blockers) });
}

export { scrubHistoricalCredentials } from '../schema.js';

export { readColdSettings, applyColdMemoryChange, applyColdOutputPoolChange } from './capacity.js';
