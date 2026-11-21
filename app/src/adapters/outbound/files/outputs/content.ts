import type { OutputBinding } from '../../../../domain/output-owner/index.js';
import { OUTPUT_CHUNK_BYTES } from '../../../../ports/output-bytes.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { Roots } from '../custody/index.js';
import type { FileJob } from './job.js';
import { published } from './files.js';
import { matchPublishedRead } from './durable.js';
import { fail } from './errors.js';

export interface ReadRange {
  start: number;
  endExclusive: number;
  write(bytes: Uint8Array): Promise<void>;
}
export async function read(
  job: FileJob<unknown>,
  roots: Roots,
  record: OutputFileRecord<OutputBinding>,
  request: ReadRange,
): Promise<void> {
  if (!Number.isSafeInteger(request.start) || request.start < 0) fail('invalid_input');
  if (
    !Number.isSafeInteger(request.endExclusive) ||
    request.endExclusive < request.start ||
    request.endExclusive > record.artifact.bytes
  )
    fail('invalid_input');
  const file = await published(job, roots, record, true);
  let offset = request.start;
  while (offset < request.endExclusive) {
    const bytes = await file.read(offset, Math.min(OUTPUT_CHUNK_BYTES, request.endExclusive - offset));
    await request.write(bytes);
    job.policy.check();
    await matchPublishedRead(file, roots, record);
    offset += bytes.length;
  }
  await matchPublishedRead(file, roots, record);
  await job.confirm(file);
}
