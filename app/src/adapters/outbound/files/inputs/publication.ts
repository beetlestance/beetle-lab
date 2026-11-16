import { createHash } from 'node:crypto';
import type { CapturedInput } from './capture.js';
import { requireState } from './capture.js';
import { PhysicalFile, promoteVerifiedFile } from '../custody/index.js';
import type { Directories, PhysicalPublication, Roots } from '../custody/index.js';
import { fail } from './job.js';

async function emptyStage(publication: PhysicalPublication, input: CapturedInput): Promise<PhysicalFile> {
  const { tree } = publication;
  if (input.bytes !== 0 || input.offset !== 0) fail('custody_missing');
  if (input.sha256 !== createHash('sha256').digest('hex')) fail('integrity');
  // Re-prove both absences immediately before the sole reconstructible create.
  if (await PhysicalFile.open(tree, publication.stage, true)
    || await PhysicalFile.open(tree, publication.destination, true)) fail('integrity');
  return PhysicalFile.create(tree, publication.stage);
}
export async function publish(tree: Directories, roots: Roots, input: CapturedInput): Promise<void> {
  requireState(input, 'publishing'); if (input.offset !== input.bytes) fail('invalid_input');
  const stage = await tree.location(roots.stage, { components: input.components, name: input.sha256 }, true);
  const destination = await tree.location(roots.published, { components: input.components, name: input.sha256 }, true);
  const publication = { tree, content: { bytes: input.bytes, sha256: input.sha256 }, stage, destination };
  if (await promoteVerifiedFile(publication)) return;
  await emptyStage(publication, input);
  if (!await promoteVerifiedFile(publication)) fail('custody_missing');
}
