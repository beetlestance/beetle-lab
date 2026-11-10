import type { Directories, Location } from './directories.js';
import { PhysicalFile } from './file.js';
import { errorCode, fail } from './errors.js';

export interface PhysicalPublication {
  readonly tree: Directories;
  readonly content: { readonly bytes: number; readonly sha256: string };
  readonly stage: Location;
  readonly destination: Location;
}
async function aliasPair(stage: PhysicalFile, destination: PhysicalFile, content: PhysicalPublication['content']): Promise<void> {
  stage.requireLinks(2n); destination.requireLinks(2n);
  await stage.verify(); await destination.verify();
  if (!stage.aliases(destination)) fail('integrity');
  await destination.verifyContent(content);
}
async function finishPair(publication: PhysicalPublication, stage: PhysicalFile, destination: PhysicalFile): Promise<void> {
  const { tree, content } = publication;
  await aliasPair(stage, destination, content); await destination.sync();
  await tree.sync(publication.destination.parent);
  await aliasPair(stage, destination, content); await tree.check();
  await tree.owner.port.unlink(publication.stage.path);
  await destination.refreshLink(publication.destination.path, 1n);
  await tree.sync(publication.stage.parent);
  await destination.verifyContent(content); destination.requireLinks(1n);
  await PhysicalFile.requireAbsent(tree, publication.stage.path); await tree.check();
}
async function promote(publication: PhysicalPublication, stage: PhysicalFile): Promise<void> {
  const { tree, content } = publication;
  stage.requireLinks(1n); await stage.verifyContent(content); await stage.sync();
  await tree.reserve(0); await stage.verify();
  try { await tree.owner.port.link(publication.stage.path, publication.destination.path); }
  catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
  // A successful link or EEXIST must both prove the exact two deterministic aliases.
  await stage.refreshLink(publication.stage.path, 2n);
  const destination = await PhysicalFile.open(tree, publication.destination, true);
  if (!destination) fail('custody_missing');
  await finishPair(publication, stage, destination);
}
/** True means verified/flushed physical custody; caller still owns original descriptor closes.
 * False means both deterministic names are absent. This never reconstructs a file.
 */
export async function promoteVerifiedFile(publication: PhysicalPublication): Promise<boolean> {
  const { tree, content, stage, destination } = publication;
  const source = await PhysicalFile.open(tree, stage, true);
  const target = await PhysicalFile.open(tree, destination, true);
  if (source && target) { await finishPair(publication, source, target); return true; }
  if (target) {
    target.requireLinks(1n); await target.verifyContent(content); await target.sync();
    await tree.sync(destination.parent); await tree.sync(stage.parent);
    target.requireLinks(1n); await target.verifyContent(content);
    await PhysicalFile.requireAbsent(tree, stage.path); return true;
  }
  if (!source) return false;
  await promote(publication, source); return true;
}
