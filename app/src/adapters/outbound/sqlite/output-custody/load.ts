import { executionArtifacts } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { EventBinding } from '../../../../ports/events.js';
import type { OutputCustodyState } from '../../../../ports/output-custody.js';
import { StorageError } from '../protocol.js';
import { readEnvelope } from './source.js';
import { decodeSlot, deriveArtifact } from './slot.js';
export function loadOutput(db: DatabaseSync, binding: EventBinding): OutputCustodyState {
  const source = readEnvelope(db, binding, false);
  if (!source) return {kind: 'pending', binding};
  const rows = db.prepare(`SELECT ordinal,CASE WHEN length(CAST(slot_json AS BLOB))<=256
    THEN slot_json ELSE NULL END slot_json FROM execution_output_slots WHERE attempt_id=? ORDER BY ordinal LIMIT 129`)
    .all(binding.key.attempt.attemptId);
  if (rows.length !== executionArtifacts(source.manifest.result).length) throw new StorageError('unavailable');
  const artifacts = rows.map((row, ordinal) => {
    if (row.ordinal !== ordinal || typeof row.slot_json !== 'string') throw new StorageError('unavailable');
    const artifact = executionArtifacts(source.manifest.result)[ordinal]!;
    return deriveArtifact(ordinal, artifact, decodeSlot(JSON.parse(row.slot_json) as unknown, artifact.bytes));
  });
  return {kind: 'adopted', binding, manifestDigest: source.manifest.manifestDigest, sourceDigest: source.sourceDigest,
    finalAgentSeq: source.closure.finalAgentSeq, version: 1, artifacts};
}
