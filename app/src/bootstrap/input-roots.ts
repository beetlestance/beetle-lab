import { initializePrivateRoots } from './private-roots.js';

export class InputDirectoryError extends Error {
  constructor() { super('Input storage initialization failed'); this.name = 'InputDirectoryError'; }
}
/** Compatibility wrapper over the installation-owned private directory initializer. */
export async function initializeInputRoots(directory: string): Promise<{ stagingRoot: string; publishedRoot: string }> {
  try { return await initializePrivateRoots(directory); }
  catch { throw new InputDirectoryError(); }
}
