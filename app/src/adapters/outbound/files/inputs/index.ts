import { capture } from './capture.js';
import type { InputRecord } from '../../../../ports/inputs.js';
import type { InputByteStore } from '../../../../ports/input-bytes.js';
import { nativePort } from '../custody/index.js';
import { openStore } from './store.js';

/** Existing canonical private sibling roots; same filesystem and numeric UID.
 * Derived UUID/hash paths only. Jobs stream <=64KiB, never overwrite publication,
 * and retain failed-close custody. The application service alone admits jobs.
 */
export function openLocalInputBytes(options: { stagingRoot: string; publishedRoot: string }): Promise<InputByteStore> {
  return openStore(options, nativePort);
}

export function inputPublicationPath(record: InputRecord): string {
  const value = capture(record); return [...value.components, value.sha256].join('/');
}
