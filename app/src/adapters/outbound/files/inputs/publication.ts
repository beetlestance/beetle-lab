import { createHash } from 'node:crypto';
import type { CapturedInput } from './capture.js';
import { requireState } from './capture.js';
import type { Directories, Location } from './directories.js';
import { InputFile } from './file.js';
import type { Roots } from './identity.js';
import { errorCode, fail } from './job.js';

interface Publication {
  readonly tree: Directories;
  readonly input: CapturedInput;
  readonly stage: Location;
  readonly destination: Location;
}
async function aliasPair(stage: InputFile, destination: InputFile, input: CapturedInput): Promise<void> {
  stage.requireLinks(2n); destination.requireLinks(2n);
  await stage.verify(); await destination.verify();
  if (!stage.aliases(destination)) fail('integrity');
  await destination.verifyContent(input);
}
async function finishPair(publication: Publication, stage: InputFile, destination: InputFile): Promise<void> {
  const { tree, input } = publication;
  await aliasPair(stage, destination, input); await destination.sync();
  await tree.sync(publication.destination.parent);
  await aliasPair(stage, destination, input); await tree.check();
  await tree.owner.port.unlink(publication.stage.path);
  await destination.refreshLink(publication.destination.path, 1n);
  await tree.sync(publication.stage.parent);
  await destination.verifyContent(input); destination.requireLinks(1n);
  await InputFile.requireAbsent(tree, publication.stage.path); await tree.check();
}
async function promote(publication: Publication, stage: InputFile): Promise<void> {
  const { tree, input } = publication;
  stage.requireLinks(1n); await stage.verifyContent(input); await stage.sync();
  await tree.reserve(0); await stage.verify();
  try { await tree.owner.port.link(publication.stage.path, publication.destination.path); }
  catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
  // A successful link or EEXIST must both prove the exact two deterministic aliases.
  await stage.refreshLink(publication.stage.path, 2n);
  const destination = await InputFile.open(tree, publication.destination, true);
  if (!destination) fail('custody_missing');
  await finishPair(publication, stage, destination);
}
async function emptyStage(publication: Publication): Promise<InputFile> {
  const { input, tree } = publication;
  if (input.bytes !== 0 || input.offset !== 0) fail('custody_missing');
  if (input.sha256 !== createHash('sha256').digest('hex')) fail('integrity');
  // Re-prove both absences immediately before the sole reconstructible create.
  if (await InputFile.open(tree, publication.stage, true)
    || await InputFile.open(tree, publication.destination, true)) fail('integrity');
  return InputFile.create(tree, publication.stage);
}
export async function publish(tree: Directories, roots: Roots, input: CapturedInput): Promise<void> {
  requireState(input, 'publishing'); if (input.offset !== input.bytes) fail('invalid_input');
  const stage = await tree.location(roots.stage, input, true);
  const destination = await tree.location(roots.published, input, true);
  const publication = { tree, input, stage, destination };
  const source = await InputFile.open(tree, stage, true);
  const target = await InputFile.open(tree, destination, true);
  if (source && target) { await finishPair(publication, source, target); return; }
  if (target) {
    target.requireLinks(1n); await target.verifyContent(input); await target.sync();
    await tree.sync(destination.parent); await tree.sync(stage.parent);
    target.requireLinks(1n); await target.verifyContent(input);
    await InputFile.requireAbsent(tree, stage.path); return;
  }
  await promote(publication, source ?? await emptyStage(publication));
}
