import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {initialize} from '../../src/adapters/outbound/sqlite/schema.js';
/** Current readers operate on an actually migrated isolated copy, never schema6.
 * Preserve the original connection/schema for historical SQL guard assertions.
 */
export function withMigratedCopy(source: DatabaseSync, check: (db: DatabaseSync) => void): void {
  if (source.isTransaction) throw new Error('Historical copy requires a committed seed');
  const root = mkdtempSync(join(tmpdir(), 'beetle-historical-copy-'));
  let current: DatabaseSync | undefined;
  try {
    const path = join(root, 'metadata.sqlite'); source.prepare('VACUUM INTO ?').run(path);
    current = initialize(path); check(current);
  } finally {current?.close(); rmSync(root, {recursive: true, force: true});}
}
