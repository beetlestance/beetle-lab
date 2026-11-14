import { record } from './capture.js';
import { outputLocation } from './paths.js';
import type { OutputBinding } from '../../../../domain/output-owner/index.js';
import type { OutputDeletionStore } from '../../../../ports/output-deletion.js';
import type { OutputByteStore } from '../../../../ports/output-bytes.js';
import { openStore } from './store.js';

/** One parent-owned namespace. Existing private sibling roots and a permanent lease;
 * mutations require adopted metadata records; removal requires a persisted native preparation plan. Close drains native jobs before lease release.
 */
export function openLocalOutputBytes(options: {
  stagingRoot: string; publishedRoot: string; leasePath: string; createLease: boolean;
}): Promise<OutputByteStore<OutputBinding> & OutputDeletionStore> { return openStore(options); }

/** Managed relative publication path only; source IDs remain captured by the byte owner. */
export function outputPublicationPath(input: unknown): string {
  const location = outputLocation(record(input)); return [...location.components, location.name].join('/');
}
