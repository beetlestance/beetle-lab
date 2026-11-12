import { fail } from './errors.js';
import type { Directories, Location } from './directories.js';
import type { PhysicalFile } from './file.js';
/** One verified single-link unlink; original handles remain owned until job close. */
export async function unlinkVerifiedFile(tree: Directories, location: Location, file: PhysicalFile): Promise<void> {
  if (location.path !== file.path) fail('integrity');
  file.requireLinks(1n); await file.verify(); await tree.check();
  await tree.owner.port.unlink(location.path); await tree.check(); await tree.sync(location.parent);
}
