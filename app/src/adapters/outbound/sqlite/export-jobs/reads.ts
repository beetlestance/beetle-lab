import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { ExportJob, ExportJobPage, LatestRevisionExport } from '@beetle/contracts/api';
import type { ExportKey, ExportList } from '../../../../ports/exports.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy, lower, scopeKey, sha256, uuid } from '../input-values.js';
import { normalizedScope } from '../suites.js';
import type { Suites } from '../suites.js';
import { StorageError } from '../protocol.js';
export type ExportRow = Record<string, SQLOutputValue>;
const header = `id,organization_id,workspace_id,attempt_id,version,state,cancellation_requested,reason,last_agent_report_at,
 CASE WHEN length(CAST(intent_json AS BLOB))<=32768 THEN intent_json END intent_json`;
/** Real indexed statement, also exercised by native EXPLAIN qualification. */
export const latestRevisionExportSql = `SELECT ${header} FROM export_jobs
 WHERE organization_id=? AND workspace_id=? AND revision_id=? ORDER BY queue_order DESC LIMIT 1`;
export function projectExport(db: DatabaseSync, row: ExportRow): ExportJob {
  if (typeof row.intent_json !== 'string') throw new StorageError('unavailable');
  const original = JSON.parse(row.intent_json) as ExportJob;
  let artifact: ExportJob['artifact'] = null;
  let madeAt: unknown = null;
  if (row.state === 'ready') {
    const file = db
      .prepare(
        `SELECT a.artifact_id,a.bytes,a.sha256,
 CASE WHEN length(CAST(s.source_json AS BLOB))<=75776
 AND json_type(s.source_json,'$.manifest.result.artifact.sealedAt')='text'
 AND length(CAST(json_extract(s.source_json,'$.manifest.result.artifact.sealedAt') AS BLOB))<=40
 THEN json_extract(s.source_json,'$.manifest.result.artifact.sealedAt') END made_at
 FROM export_artifacts a JOIN export_sources s ON s.export_id=a.export_id
 WHERE a.export_id=? AND a.phase='published' AND a.writer IS NULL AND a.identity IS NOT NULL AND a.offset=a.bytes`,
      )
      .get(row.id!);
    if (
      typeof file?.artifact_id !== 'string' ||
      typeof file.bytes !== 'number' ||
      typeof file.sha256 !== 'string' ||
      typeof file.made_at !== 'string'
    )
      throw new StorageError('unavailable');
    madeAt = file.made_at;
    artifact = {
      artifactId: file.artifact_id,
      bytes: file.bytes,
      sha256: file.sha256,
      name: 'suite.js',
      mediaType: 'text/javascript',
    };
  }
  const value = {
    ...original,
    version: row.version,
    state: row.state,
    cancellationRequested: row.cancellation_requested === 1,
    reason: row.reason,
    artifact,
    madeAt,
    lastAgentReportAt: row.last_agent_report_at,
  };
  const checked = validateApi('ExportJob', value);
  if (!checked.ok) throw new StorageError('unavailable');
  return checked.value;
}
export class ExportReads {
  constructor(
    private readonly db: DatabaseSync,
    private readonly suites: Suites,
  ) {}
  row(key: ExportKey): ExportRow {
    const scope = normalizedScope(key.scope);
    this.suites.workspace(scope);
    const row = this.db
      .prepare(`SELECT ${header} FROM export_jobs WHERE id=? AND organization_id=? AND workspace_id=?`)
      .get(lower(key.id), scope.organizationId, scope.workspaceId);
    if (!row) throw new StorageError('not_found');
    return row;
  }
  get(key: ExportKey): ExportJob {
    return projectExport(this.db, this.row(key));
  }
  latest(key: ExportKey): LatestRevisionExport {
    const scope = normalizedScope(key.scope);
    this.suites.workspace(scope);
    const revisionId = lower(key.id);
    const revision = this.db
      .prepare('SELECT 1 AS present FROM suite_revisions WHERE organization_id=? AND workspace_id=? AND id=?')
      .get(scope.organizationId, scope.workspaceId, revisionId);
    if (!revision) throw new StorageError('not_found');
    const row = this.db.prepare(latestRevisionExportSql).get(scope.organizationId, scope.workspaceId, revisionId);
    return { scope, revisionId, job: row ? projectExport(this.db, row) : null };
  }
  list(query: ExportList): ExportJobPage {
    const scope = normalizedScope(query.scope);
    this.suites.workspace(scope);
    const cursor = after(query);
    const rows = this.db
      .prepare(
        `SELECT ${header} FROM export_jobs WHERE organization_id=? AND workspace_id=? AND id>? ORDER BY id LIMIT ?`,
      )
      .all(scope.organizationId, scope.workspaceId, cursor, query.limit + 1);
    const last = rows[query.limit - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ identity: queryIdentity(query), after: last.id })).toString('base64url')
        : null;
    return { scope, items: rows.slice(0, query.limit).map((row) => projectExport(this.db, row)), nextCursor };
  }
}

function queryIdentity(query: ExportList): string {
  return sha256(JSON.stringify(['exports', scopeKey(query.scope), query.limit]));
}
function after(query: ExportList): string {
  if (query.cursor === undefined) return '';
  try {
    const cursor = boundedCopy(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as { identity: string; after: string },
      1024,
    );
    requireRule(cursor.identity === queryIdentity(query));
    uuid(cursor.after);
    return lower(cursor.after);
  } catch {
    throw new StorageError('invalid_input');
  }
}
