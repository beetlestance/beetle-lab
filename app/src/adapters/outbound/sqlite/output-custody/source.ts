import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import type { EventBinding } from '../../../../ports/events.js';
import { StorageError } from '../protocol.js';
import { sha256 } from '../input-values.js';
function retained(db: DatabaseSync, binding: EventBinding, body: boolean): Record<string, SQLOutputValue> {
  const { key, journalAuthority } = binding; const a = key.attempt;
  const row = db.prepare(`SELECT CASE WHEN ?=1 AND length(CAST(t.offer_json AS BLOB))<=2097152 THEN t.offer_json ELSE NULL END offer_json
    FROM execution_records e JOIN attempts t ON t.id=e.attempt_id
    JOIN attempt_output_allocations x ON x.attempt_id=e.attempt_id AND x.run_id=e.run_id
      AND x.organization_id=e.organization_id AND x.workspace_id=e.workspace_id
    WHERE e.attempt_id=? AND e.run_id=? AND e.organization_id=? AND e.workspace_id=? AND e.intent_digest=?
      AND e.journal_authority=? AND e.acknowledged_generation=1 AND e.output_pending=1`)
    .get(Number(body), a.attemptId, key.runId, a.organizationId, a.workspaceId, a.intentDigest, journalAuthority);
  if (!row) throw new StorageError('not_found');
  return row;
}
/** Exact retained physical original; no Offer, manifest or source body is materialized. */
export function requireRetainedOriginal(db: DatabaseSync, binding: EventBinding): void {
  retained(db, binding, false);
}
export function original(db: DatabaseSync, binding: EventBinding): Offer {
  const row = retained(db, binding, true);
  if (typeof row.offer_json !== 'string') throw new StorageError('unavailable');
  const value = validate('Offer', JSON.parse(row.offer_json) as unknown);
  if (!value.ok) throw new StorageError('unavailable');
  const a = binding.key.attempt;
  if (value.value.attemptId !== a.attemptId || value.value.organizationId !== a.organizationId
    || value.value.workspaceId !== a.workspaceId || value.value.intentDigest !== a.intentDigest) throw new StorageError('conflict');
  return value.value;
}
export function pins(value: Owned<SourceEnvelope>, binding: EventBinding, offer: Offer): void {
  const b = value.manifest.binding; const a = binding.key.attempt;
  const equal = b.organizationId === a.organizationId && b.workspaceId === a.workspaceId && b.attemptId === a.attemptId
    && b.intentDigest === a.intentDigest && b.generation === a.generation && b.journalAuthority === binding.journalAuthority;
  if (!equal || encodeCanonicalJson(b.engine, 4096) !== encodeCanonicalJson(offer.engine, 4096)
    || encodeCanonicalJson(b.installedIdentity, 4096) !== encodeCanonicalJson(offer.installedIdentity, 4096)) throw new StorageError('conflict');
  const ids = value.manifest.result.artifacts.map(artifact => artifact.artifactId.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new StorageError('conflict');
}
function storedPins(row: Record<string, SQLOutputValue>, envelope: Owned<SourceEnvelope>, binding: EventBinding): void {
  const a = binding.key.attempt;
  if (row.run_id !== binding.key.runId || row.organization_id !== a.organizationId || row.workspace_id !== a.workspaceId
    || row.intent_digest !== a.intentDigest || row.journal_authority !== binding.journalAuthority
    || row.version !== 1 || row.generation !== 1 || row.manifest_digest !== envelope.manifest.manifestDigest
    || row.final_agent_seq !== envelope.closure.finalAgentSeq) throw new StorageError('conflict');
}
export function readEnvelope(db: DatabaseSync, binding: EventBinding, checkOriginal = true): Owned<SourceEnvelope> | null {
  const offer = checkOriginal ? original(db, binding) : null;
  if (!checkOriginal) retained(db, binding, false);
  const row = db.prepare(`SELECT s.source_digest,s.manifest_digest,s.final_agent_seq,s.version,s.generation,
    s.run_id,s.organization_id,s.workspace_id,s.intent_digest,s.journal_authority,
    CASE WHEN length(CAST(s.closure_json AS BLOB))<=2048 THEN s.closure_json ELSE NULL END closure_json,
    CASE WHEN length(CAST(p.canonical_json AS BLOB))<=73728 THEN p.canonical_json ELSE NULL END canonical_json
    FROM execution_output_sources s LEFT JOIN execution_output_payloads p ON p.attempt_id=s.attempt_id AND p.kind='manifest'
    WHERE s.attempt_id=?`).get(binding.key.attempt.attemptId);
  if (!row) return null;
  if (typeof row.closure_json !== 'string' || typeof row.canonical_json !== 'string') throw new StorageError('unavailable');
  const envelope = verifySourceEnvelope({ version: 1, sourceDigest: row.source_digest,
    manifest: JSON.parse(row.canonical_json) as unknown, closure: JSON.parse(row.closure_json) as unknown }, sha256);
  storedPins(row, envelope, binding);
  if (offer) pins(envelope, binding, offer);
  return envelope;
}
