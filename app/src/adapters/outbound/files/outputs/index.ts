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
