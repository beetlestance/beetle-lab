import {transitionArtifact} from './transition.js';
export {transitionArtifact} from './transition.js';
export type {ArtifactTransition} from './transition.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import { StorageError } from '../protocol.js';
import { loadOutput } from '../output-custody/load.js';
import { artifactSlot } from '../output-custody/slot.js';
import type { ArtifactOperation } from './wire.js';
export { artifactOperation, captureArtifactOperation, captureArtifactMutation, captureArtifactReply } from './wire.js';
export type { ArtifactOperation } from './wire.js';
function conflict(condition: boolean): void { if (!condition) throw new StorageError('conflict'); }
/** Runs inside the existing metadata transaction; never owns native IO or a lease. */
export function executeArtifact(db: DatabaseSync, operation: ArtifactOperation): OutputFileRecord {
  const { key } = operation.request; const state = loadOutput(db, key.binding);
  if (state.kind !== 'adopted') throw new StorageError('not_found');
  conflict(state.manifestDigest === key.manifestDigest && state.sourceDigest === key.sourceDigest);
  const artifact = state.artifacts[key.ordinal]; if (!artifact) throw new StorageError('not_found');
  const record = {binding: key.binding, artifact}; const next = transitionArtifact(operation, artifact);
  if (next.version === artifact.version) return record;
  db.prepare('UPDATE execution_output_slots SET slot_json=? WHERE attempt_id=? AND ordinal=?')
    .run(encodeCanonicalJson(artifactSlot(next), 256), key.binding.key.attempt.attemptId, key.ordinal);
  return {binding: key.binding, artifact: next};
}
