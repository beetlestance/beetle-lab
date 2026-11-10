import { lstat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { initializePrivateRoots } from '../private-roots.js';

/** Existing namespaces never authorize creation of a replacement lease. An
 * interrupted first initialization fails explicitly on the next startup. */
export async function outputRoots(dataRoot: string) {
  if (typeof dataRoot !== 'string' || !isAbsolute(dataRoot) || normalize(dataRoot) !== dataRoot) throw new Error('Invalid output root');
  const directory = join(dataRoot, 'outputs');
  let createLease = false;
  try { await lstat(directory); }
  catch (error) {
    if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    createLease = true;
  }
  const roots = await initializePrivateRoots(directory);
  return {...roots, leasePath: join(directory, 'namespace.sqlite'), createLease};
}
