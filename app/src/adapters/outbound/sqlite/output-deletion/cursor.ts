import type { OutputDeletionScan } from '../../../../ports/output-deletion-metadata.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { StorageError } from '../protocol.js';
export function cursor(after: number, limit: number): string {return Buffer.from(JSON.stringify(['output-deletion-v1', limit, after])).toString('base64url');}
export function position(query: OutputDeletionScan): number {
  if (query.cursor === undefined) return 0;
  try {
    requireRule(query.cursor.length <= 256 && /^[A-Za-z0-9_-]+$/.test(query.cursor));
    const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as unknown;
    requireRule(Array.isArray(value) && value.length === 3 && value[0] === 'output-deletion-v1' && value[1] === query.limit
      && typeof value[2] === 'number' && Number.isSafeInteger(value[2]) && value[2] > 0);
    requireRule(cursor(value[2] as number, query.limit) === query.cursor); return value[2] as number;
  } catch {throw new StorageError('invalid_input');}
}
