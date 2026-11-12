import type { DatabaseSync } from 'node:sqlite';
import { verifyEngineResultSeal, captureStandaloneExportResult, executionEngineId, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { ExecutionResult } from '@beetle/contracts';
import type { Scope, Reservation } from '../admission/index.js';
import { captureCollectionIntent, verifyOutputSource, OUTPUT_COLLECTION_INTENT_BYTES, OUTPUT_SOURCE_BYTES } from '../output-source/index.js';
import type { CollectionIntent, PrivateSource, SourceBinding } from '../output-source/index.js';
import { readExport } from './export-assignment.js';
import { readJournalAuthority } from './authority.js';
import { readWrapperCheckpoint } from './checkpoint.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { requireSettledRelease } from './launch-settlement.js';
import { owner, quotaUsed, Failure } from './sql.js';
import type { Row } from './sql.js';
import { parseSourceJson, requireSource, sameSource, sourceHash, sourceJson } from './output-source-input.js';

export interface IntentRecord { value: CollectionIntent; phase: 'pending' | 'sourced' | 'failed'; epoch: string }
export interface SourceState { row: Row; intent: IntentRecord | null; source: PrivateSource | null; reservation: Reservation | null }
export function bindingKey(value: SourceBinding): Scope {
  return { organizationId: value.organizationId, workspaceId: value.workspaceId, attemptId: value.attemptId, generation: value.generation };
}
function loadIntent(db: DatabaseSync, row: Row): IntentRecord | null {
  const record = db.prepare(`SELECT phase,created_epoch,collection_id,charged_bytes,
    CASE WHEN typeof(intent_json)='text' AND length(CAST(intent_json AS BLOB))<=${OUTPUT_COLLECTION_INTENT_BYTES}
      THEN intent_json ELSE NULL END AS json FROM output_collection_intents WHERE attempt_id=?`).get(row.attempt_id);
  if (!record) { requireSource(row.collection_bytes === 0, 'unavailable'); return null; }
  requireSource(typeof record.json === 'string', 'unavailable');
  const value = captureCollectionIntent(parseSourceJson(record.json, OUTPUT_COLLECTION_INTENT_BYTES));
  requireSource(sourceJson(value, OUTPUT_COLLECTION_INTENT_BYTES) === record.json, 'unavailable');
  requireSource(record.charged_bytes === Buffer.byteLength(record.json) + 256 && row.collection_bytes === record.charged_bytes, 'unavailable');
  requireSource(record.collection_id === value.collectionId && ['pending', 'sourced', 'failed'].includes(String(record.phase)), 'unavailable');
  requireSource(typeof record.created_epoch === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.created_epoch), 'unavailable');
  return { value, phase: record.phase as IntentRecord['phase'], epoch: record.created_epoch };
}
function loadSource(db: DatabaseSync, row: Row): PrivateSource | null {
  const record = db.prepare(`SELECT charged_bytes,manifest_digest,source_digest,
    CASE WHEN typeof(source_json)='text' AND length(CAST(source_json AS BLOB))<=${OUTPUT_SOURCE_BYTES}
      THEN source_json ELSE NULL END AS json FROM output_sources WHERE attempt_id=?`).get(row.attempt_id);
  if (!record) { requireSource(row.source_bytes === 0, 'unavailable'); return null; }
  requireSource(typeof record.json === 'string', 'unavailable');
  const value = verifyOutputSource(parseSourceJson(record.json, OUTPUT_SOURCE_BYTES), sourceHash);
  requireSource(sourceJson(value, OUTPUT_SOURCE_BYTES) === record.json, 'unavailable');
  requireSource(record.charged_bytes === Buffer.byteLength(record.json) + 256 && row.source_bytes === record.charged_bytes, 'unavailable');
  requireSource(record.manifest_digest === value.manifest.manifestDigest && record.source_digest === value.sourceDigest, 'unavailable');
  return value;
}
export function original(db: DatabaseSync, key: Scope) {
  const row = owner(db, key);
  const fact = admissionSnapshot(db, row); requireSource(fact?.state === 'charged' || fact?.state === 'released', 'unavailable');
  const stored = db.prepare(`SELECT CASE WHEN length(CAST(reservation_json AS BLOB))<=32768
    THEN reservation_json ELSE NULL END AS json FROM reservations WHERE attempt_id=?`).get(row.attempt_id);
  requireSource(typeof stored?.json === 'string', 'unavailable');
  const reservation = JSON.parse(stored.json) as Reservation;
  const offer = db.prepare(`SELECT CASE WHEN json_valid(offer_json) AND length(CAST(offer_json AS BLOB))<=${RUNNER_MAXIMUM_OFFER_BYTES}
    THEN json_extract(offer_json,'$.engine') END AS engine,
    CASE WHEN json_valid(offer_json) AND length(CAST(offer_json AS BLOB))<=${RUNNER_MAXIMUM_OFFER_BYTES}
    THEN json_extract(offer_json,'$.installedIdentity') END AS installed FROM accepted_attempts WHERE id=?`).get(row.id);
  requireSource(typeof offer?.engine === 'string' && typeof offer.installed === 'string', 'unavailable');
  checkHold(db, row, reservation);
  const checkpoint = readWrapperCheckpoint(db, key);
  requireSource(checkpoint && checkpoint.wrapperSeq === row.wrapper_high,'unavailable');
  const result=originalResult(db,key,row);
  return { row, reservation, checkpoint, result, engine: JSON.parse(offer.engine) as unknown,
    installedIdentity: JSON.parse(offer.installed) as unknown, authority: readJournalAuthority(db) };
}
function checkHold(db: DatabaseSync, row: Row, reservation: Reservation): void {
  const hold = db.prepare('SELECT * FROM disk_holds WHERE attempt_id=?').get(row.attempt_id);
  requireSource(hold && row.hold_bytes === 512 && hold.metadata_bytes === 512, 'unavailable');
  requireSource(hold.organization_id === row.organization_id && hold.workspace_id === row.workspace_id
    && hold.generation === row.generation && hold.intent_digest === row.intent_digest, 'unavailable');
  requireSource(hold.output_bytes === reservation.resources.outputBytes && hold.staging_bytes === reservation.resources.stagingBytes, 'unavailable');
  requireSource(hold.phase === (reservation.status === 'charged' ? 'active' : 'retained'), 'unavailable');
}
export function matchOriginal(db: DatabaseSync, intent: CollectionIntent) {
  const value = original(db, bindingKey(intent.binding)); const { binding } = intent;
  requireSource(binding.journalAuthority === value.authority && binding.intentDigest === value.row.intent_digest, 'conflict');
  requireSource(sameSource(binding.engine, value.engine) && sameSource(binding.installedIdentity, value.installedIdentity), 'conflict');
  requireSource(sameSource(intent.checkpoint, value.checkpoint) && sameSource(intent.launch, value.reservation.launchSettlement), 'conflict');
  requireSource(value.reservation.createToken === intent.launch.createToken && value.reservation.runtimeId === intent.launch.runtimeId
    && value.reservation.specDigest === binding.specDigest, 'conflict');
  resultScope(value.result, binding); return value;
}
function resultScope(result: ExecutionResult, binding: SourceBinding): void {
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) requireSource(result[key] === binding[key], 'conflict');
  requireSource(executionEngineId(result) === binding.engine.id, 'conflict');
}
export function matchIntent(source: PrivateSource, intent: CollectionIntent, reservation: Reservation): void {
  requireSource(sameSource(source.manifest.binding, intent.binding) && sameSource(source.root, intent.root)
    && sameSource(source.checkpoint, intent.checkpoint), 'conflict');
  requireSource(sameSource(source.release.runtime, intent.runtime), 'conflict');
  const release = source.release; const launch = intent.launch;
  requireSource(release.collection.evidenceId === intent.collectionId && release.collection.observedAt >= intent.begunAt, 'conflict');
  requireSource(release.createToken === launch.createToken && release.runtimeId === launch.runtimeId && release.specDigest === launch.specDigest, 'conflict');
  requireSource(release.launch.epoch === launch.epoch && release.launch.startToken === launch.startToken
    && release.launch.settlementId === launch.evidenceId, 'conflict');
  requireSource(source.manifest.verifiedBytes <= reservation.budget.outputBytes, 'conflict');
  requireSettledRelease(reservation, release);
}
export function readSourceState(db: DatabaseSync, key: Scope): SourceState {
  const row = owner(db, key);
  try {
    requireSource(quotaUsed(row) <= row.quota_bytes, 'unavailable');
    const intent = loadIntent(db, row); const source = loadSource(db, row);
    if (!intent) { requireSource(source === null, 'unavailable'); return { row, intent, source, reservation: null }; }
    const current = matchOriginal(db, intent.value); const reservation = current.reservation;
    if (source) {
      requireSource(intent.phase === 'sourced', 'unavailable'); matchIntent(source, intent.value, reservation);
      requireSource(sameSource(source.manifest.result, current.result), 'unavailable');
      if (reservation.status === 'released') requireSource(sameSource(reservation.releaseEvidence, source.release), 'unavailable');
    } else if (intent.phase === 'failed') {
      requireSource(reservation.status === 'released' && reservation.releaseEvidence?.collection.state === 'failed', 'unavailable');
      const evidence = reservation.releaseEvidence;
      requireSource(evidence.collection.evidenceId === intent.value.collectionId && evidence.collection.observedAt >= intent.value.begunAt, 'unavailable');
      requireSource(sameSource(evidence.runtime, intent.value.runtime), 'unavailable'); requireSettledRelease(reservation, evidence);
    } else requireSource(intent.phase === 'pending' && reservation.status === 'charged', 'unavailable');
    return { row, intent, source, reservation };
  } catch { throw new Failure('unavailable'); }
}

function originalResult(db:DatabaseSync,key:Scope,row:Row):ExecutionResult {
  const assignment=readExport(db,key);
  const json=assignment ? row.export_result_json : row.result_json;
  requireSource(typeof json === 'string','unavailable');
  const result = assignment ? {ok:true as const,value:captureStandaloneExportResult(parseSourceJson(json,8192),assignment,sourceHash)}
    : verifyEngineResultSeal(parseSourceJson(json,65_536),sourceHash);
  requireSource(result.ok, 'unavailable');
  return result.value;
}
