import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import { StorageError } from '../protocol.js';
import { loadOutput } from '../output-custody/load.js';
import { artifactSlot } from '../output-custody/slot.js';
import type { Slot } from '../output-custody/slot.js';
import type { ArtifactOperation } from './wire.js';
export { artifactOperation, captureArtifactOperation, captureArtifactReply } from './wire.js';
export type { ArtifactOperation } from './wire.js';
function conflict(condition: boolean): void { if (!condition) throw new StorageError('conflict'); }
function transition(operation: ArtifactOperation, record: OutputFileRecord): Slot {
  const request = operation.request; const current = record.artifact; const next = artifactSlot(current);
  conflict(request.expectedVersion <= current.version);
  if (operation.kind === 'outputClaimArtifact') {
    if (current.phase === 'published' || current.writer === request.writerId) return next;
    conflict(current.phase === 'transferring' && current.writer === null); next.w = request.writerId;
  } else if (operation.kind === 'outputRecordPublication') {
    const receipt = operation.request.receipt;
    conflict(receipt.token === current.token && receipt.offset === current.bytes);
    if (current.phase === 'published') {
      conflict(current.identity === receipt.identity && current.offset === receipt.offset); return next;
    }
    conflict(current.writer === request.writerId && current.phase === 'publishing');
    next.p = 'published'; next.w = null; next.i = receipt.identity;
  } else {
    conflict(current.writer === request.writerId);
    return transferTransition(operation, record, next);
  }
  return changed(request.expectedVersion, current.version, next);
}
function transferTransition(operation: Exclude<ArtifactOperation, {kind: 'outputRecordPublication' | 'outputClaimArtifact'}>,
  record: OutputFileRecord, next: Slot): Slot {
  const current = record.artifact;
  if (operation.kind === 'outputBeginPublication') {
    if (current.phase === 'publishing') return next;
    conflict(current.phase === 'transferring' && current.offset === current.bytes && current.identity !== null);
    next.p = 'publishing';
  } else {
    const receipt = operation.request.receipt;
    conflict(receipt.token === current.token && receipt.offset <= current.bytes);
    conflict(current.identity === null || current.identity === receipt.identity);
    if (current.identity === receipt.identity && current.offset >= receipt.offset) return next;
    conflict(current.phase === 'transferring'); next.o = receipt.offset; next.i = receipt.identity;
  }
  return changed(operation.request.expectedVersion, current.version, next);
}
function changed(expected: number, version: number, next: Slot): Slot {
  conflict(expected === version && version < Number.MAX_SAFE_INTEGER); next.v = version + 1; return next;
}
/** Runs inside the existing metadata transaction; never owns native IO or a lease. */
export function executeArtifact(db: DatabaseSync, operation: ArtifactOperation): OutputFileRecord {
  const { key } = operation.request; const state = loadOutput(db, key.binding);
  if (state.kind !== 'adopted') throw new StorageError('not_found');
  conflict(state.manifestDigest === key.manifestDigest && state.sourceDigest === key.sourceDigest);
  const artifact = state.artifacts[key.ordinal]; if (!artifact) throw new StorageError('not_found');
  const record = {binding: key.binding, artifact}; const next = transition(operation, record);
  if (next.v === artifact.version) return record;
  db.prepare('UPDATE execution_output_slots SET slot_json=? WHERE attempt_id=? AND ordinal=?')
    .run(encodeCanonicalJson(next, 256), key.binding.key.attempt.attemptId, key.ordinal);
  return {binding: key.binding, artifact: {...artifact, version: next.v, writer: next.w, phase: next.p, offset: next.o, identity: next.i}};
}
