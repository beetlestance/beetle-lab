import { fstatSync, lstatSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import type { Owned } from './types.js';
import { RecoveryError } from './types.js';
import { regular, stable } from './files.js';
export interface Destination {readonly path: string; readonly file: Owned<FileHandle>; readonly original: BigIntStats; readonly maximum: number}
export function checkDestination(value: Destination): void {
  const held = fstatSync(value.file.value.fd, {bigint: true}); const named = lstatSync(value.path, {bigint: true});
  regular(held, value.maximum); regular(named, value.maximum);
  const first = value.original;
  if (held.dev !== first.dev || held.ino !== first.ino || held.uid !== first.uid || held.gid !== first.gid || held.mode !== first.mode || stable(named) !== stable(held)) throw new RecoveryError('integrity');
}
/** Node24.12 opens the destination synchronously before scheduling its copy work.
 * Keep the original FD and check the name inside this primitive, with no await.
 * This is a private same-UID namespace, not protection against a hostile OS owner.
 */
export const nativeDatabase = {
  backup(source: DatabaseSync, destination: Destination, options: Parameters<typeof backup>[2]) {
    checkDestination(destination);
    if (stable(fstatSync(destination.file.value.fd, {bigint: true})) !== stable(destination.original)) throw new RecoveryError('integrity');
    return backup(source, destination.path, options);
  },
  open(destination: Destination): DatabaseSync {
    checkDestination(destination); return new DatabaseSync(destination.path, {timeout: 100, defensive: true});
  },
};
