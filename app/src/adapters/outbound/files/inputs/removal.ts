import type { CapturedInput } from './capture.js';
import { requireState } from './capture.js';
import type { Directories, Location } from '../custody/index.js';
import { PhysicalFile, unlinkVerifiedFile } from '../custody/index.js';
import type { Roots } from '../custody/index.js';
import { fail } from './job.js';

async function unlinkPair(tree: Directories, locations: readonly [Location, Location],
  files: readonly [PhysicalFile, PhysicalFile], input: CapturedInput): Promise<void> {
  const [stage, destination] = files;
  stage.requireLinks(2n); destination.requireLinks(2n);
  await stage.verify(); await destination.verify();
  if (!stage.aliases(destination)) fail('integrity');
  await destination.verifyContent(input); await stage.verify();
  await tree.owner.port.unlink(locations[0].path);
  await destination.refreshLink(locations[1].path, 1n); await tree.sync(locations[0].parent);
  await unlinkVerifiedFile(tree, locations[1], destination);
}
async function unlinkSingles(tree: Directories, locations: readonly [Location, Location],
  files: readonly [PhysicalFile | undefined, PhysicalFile | undefined]): Promise<void> {
  const [source, target] = files;
  // Classify both names before deleting either: third links fail without cleanup.
  source?.requireLinks(1n); target?.requireLinks(1n);
  if (source) await unlinkVerifiedFile(tree, locations[0], source);
  if (target) await unlinkVerifiedFile(tree, locations[1], target);
}
export async function remove(tree: Directories, roots: Roots, input: CapturedInput): Promise<void> {
  requireState(input, 'deleting');
  const stage = await tree.location(roots.stage, { components: input.components, name: input.sha256 }, false);
  const destination = await tree.location(roots.published, { components: input.components, name: input.sha256 }, false);
  const source = await PhysicalFile.open(tree, stage, false);
  const target = await PhysicalFile.open(tree, destination, false);
  if (source && target && (source.links === 2n || target.links === 2n)) {
    await unlinkPair(tree, [stage, destination], [source, target], input);
  } else await unlinkSingles(tree, [stage, destination], [source, target]);
  // Absence recovery still needs the nearest extant ancestor durably flushed.
  await tree.sync(stage.parent); await tree.sync(destination.parent); await tree.check();
  if (await PhysicalFile.open(tree, stage, false) || await PhysicalFile.open(tree, destination, false)) fail('integrity');
}
