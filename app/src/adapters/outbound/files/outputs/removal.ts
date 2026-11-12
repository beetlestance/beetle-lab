import { encodeJson } from '@beetle/contracts';
import { OUTPUT_DELETION_BYTES } from '../../../../ports/output-deletion.js';
import type { OutputDeletionIntent, OutputDeletionRequest, OutputDeletionReceipt } from '../../../../ports/output-deletion.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import { PhysicalFile, unlinkVerifiedFile } from '../custody/index.js';
import type { Roots } from '../custody/index.js';
import type { FileJob } from './job.js';
import { fields, uuid } from './capture.js';
import { locations, match, published } from './files.js';
import { deletionNamespace, deletionPreparation } from './identity.js';
import { fail } from './errors.js';
function intent(value: Record<string, unknown>, claim: (input: unknown) => OutputFileRecord): OutputDeletionIntent {
  const record = claim(value.record); const artifact = record.artifact;
  if (!uuid(value.deletionId) || typeof value.deletionVersion !== 'number' || !Number.isSafeInteger(value.deletionVersion) || value.deletionVersion < 1) fail('invalid_input');
  if (artifact.phase !== 'published' || artifact.writer !== null || artifact.identity === null || artifact.offset !== artifact.bytes) fail('invalid_input');
  return {record, deletionId: value.deletionId, deletionVersion: value.deletionVersion};
}
export function captureDeletionIntent(input: unknown, claim: (input: unknown) => OutputFileRecord): OutputDeletionIntent {
  const value = intent(fields(input, ['record', 'deletionId', 'deletionVersion']), claim);
  encodeJson(value, OUTPUT_DELETION_BYTES); return Object.freeze(value);
}
export function captureDeletion(input: unknown, claim: (input: unknown) => OutputFileRecord, roots: Roots): OutputDeletionRequest {
  const value = fields(input, ['record', 'deletionId', 'deletionVersion', 'namespaceIdentity', 'preparationIdentity']);
  const captured = intent(value, claim);
  if (!hash(value.namespaceIdentity) || !hash(value.preparationIdentity)) fail('invalid_input');
  const result = {...captured, namespaceIdentity: value.namespaceIdentity, preparationIdentity: value.preparationIdentity};
  encodeJson(result, OUTPUT_DELETION_BYTES);
  if (result.namespaceIdentity !== deletionNamespace(roots) || result.preparationIdentity !== deletionPreparation(result, result.namespaceIdentity)) fail('integrity');
  return Object.freeze(result);
}
function hash(value: unknown): value is string {return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);}
/** Positive preparation requires original present-file custody, including post-close checks. */
export async function prepareRemoval(job: FileJob<unknown>, roots: Roots, value: OutputDeletionIntent): Promise<OutputDeletionRequest> {
  const file = await published(job, roots, value.record); await job.confirm(file);
  const namespaceIdentity = deletionNamespace(roots);
  const result = Object.freeze({...value, namespaceIdentity, preparationIdentity: deletionPreparation(value, namespaceIdentity)});
  encodeJson(result, OUTPUT_DELETION_BYTES); return result;
}
/** A durable exact plan is required even when names are already absent. */
export async function remove(job: FileJob<unknown>, roots: Roots, request: OutputDeletionRequest): Promise<OutputDeletionReceipt> {
  if (request.namespaceIdentity !== deletionNamespace(roots) || request.preparationIdentity !== deletionPreparation(request, request.namespaceIdentity)) fail('integrity');
  const places = await locations(job, roots, request.record, false);
  await PhysicalFile.requireAbsent(job.tree, places.stage.absentAncestor ?? places.stage.path);
  const file = await PhysicalFile.open(job.tree, places.destination, false);
  if (file) {
    file.requireLinks(1n); await match(file, roots, request.record, true);
    await unlinkVerifiedFile(job.tree, places.destination, file);
  }
  await job.tree.sync(places.stage.parent); await job.tree.sync(places.destination.parent);
  await job.confirmAbsent([places.stage, places.destination]);
  const receipt = Object.freeze({...request, phase: 'absent' as const});
  encodeJson(receipt, OUTPUT_DELETION_BYTES); return receipt;
}
