import type { InputByteStore } from '../../../../ports/input-bytes.js';
import { nativePort } from './native.js';
import { openStore } from './store.js';

/** Existing canonical private sibling roots; same filesystem and numeric UID.
 * Derived UUID/hash paths only. Jobs stream <=64KiB, never overwrite publication,
 * and retain failed-close custody. The application service alone admits jobs.
 */
export function openLocalInputBytes(options: { stagingRoot: string; publishedRoot: string }): Promise<InputByteStore> {
  return openStore(options, nativePort);
}
