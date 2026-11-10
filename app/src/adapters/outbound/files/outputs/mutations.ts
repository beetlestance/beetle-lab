import type { OutputFileReceipt, OutputFileRecord } from '../../../../ports/output-bytes.js';
import { PhysicalFile, promoteVerifiedFile } from '../custody/index.js';
import type { Roots } from '../custody/index.js';
import type { FileJob } from './job.js';
import { locations, match, mutation, published, receipt, stage } from './files.js';
import { fail } from './errors.js';

export async function prepare(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord): Promise<OutputFileReceipt> {
  if (record.artifact.phase === 'published') return receipt(job, roots, record, await published(job, roots, record), true);
  if (record.artifact.phase === 'transferring') {
    mutation(record, 'transferring'); return receipt(job, roots, record, await stage(job, roots, record), false);
  }
  mutation(record, 'publishing');
  const places = await locations(job, roots, record, false);
  const source = await PhysicalFile.open(job.tree, places.stage, false);
  const target = await PhysicalFile.open(job.tree, places.destination, false);
  if (source && target) fail('integrity');
  if (target) return publish(job, roots, record);
  if (!source) fail('custody_missing');
  source.requireLinks(1n); await match(source, roots, record, false); await source.sync();
  await job.tree.sync(places.stage.parent); return receipt(job, roots, record, source, false);
}
async function compare(file: PhysicalFile, bytes: Uint8Array, offset: number): Promise<void> {
  let compared = 0;
  while (compared < bytes.length) {
    const current = await file.read(offset + compared, bytes.length - compared);
    for (let index = 0; index < current.length; index++) if (current[index] !== bytes[compared + index]) fail('integrity');
    compared += current.length;
  }
}
export async function append(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord,
  request: { offset: number; bytes: Uint8Array }): Promise<OutputFileReceipt> {
  mutation(record, 'transferring');
  if (record.artifact.identity === null || request.offset !== record.artifact.offset) fail('invalid_input');
  const end = request.offset + request.bytes.length;
  if (!Number.isSafeInteger(end) || end > record.artifact.bytes) fail('invalid_input');
  const file = await stage(job, roots, record);
  const overlap = Math.min(request.bytes.length, Number(file.size) - request.offset);
  await compare(file, request.bytes.subarray(0, overlap), request.offset);
  const suffix = request.bytes.subarray(overlap);
  if (suffix.length) { await job.tree.reserve(suffix.length); await file.write(suffix, Number(file.size)); }
  await file.sync(); return receipt(job, roots, record, file, false);
}
export async function publish(job: FileJob<unknown>, roots: Roots, record: OutputFileRecord): Promise<OutputFileReceipt> {
  mutation(record, 'publishing');
  if (record.artifact.identity === null) fail('custody_missing');
  const places = await locations(job, roots, record, true);
  const source = await PhysicalFile.open(job.tree, places.stage, true);
  const target = await PhysicalFile.open(job.tree, places.destination, true);
  const original = source ?? target; if (!original) fail('custody_missing');
  await match(original, roots, record, false);
  if (!await promoteVerifiedFile(places)) fail('custody_missing');
  // Keep the pre-promotion descriptor and content signature across the shared owner.
  await original.refreshLink(places.destination.path, 1n);
  return receipt(job, roots, record, original, true);
}
