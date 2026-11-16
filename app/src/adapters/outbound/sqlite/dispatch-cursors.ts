import { validatePrimitive } from '@beetle/contracts';
import type { DispatchScan } from '../../../ports/dispatch.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { boundedCopy } from './input-values.js';
import { StorageError } from './protocol.js';

export interface Position { order: number; id: string }
export interface DispatchCursor { installation: string; lane: DispatchScan['lane']; upper: Position; after: Position }
export function comparePosition(a: Position, b: Position): number {
  return a.order - b.order || (a.id < b.id ? -1 : Number(a.id > b.id));
}
export function captureScan(input: DispatchScan): DispatchScan {
  const query = boundedCopy(input, 2048);
  requireRule(query !== null && typeof query === 'object'
    && Object.keys(query).every(key => ['lane', 'limit', 'cursor'].includes(key)));
  requireRule(['queued', 'reconcile'].includes(query.lane));
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 32);
  if (query.cursor !== undefined) requireRule(typeof query.cursor === 'string' && Buffer.byteLength(query.cursor) <= 1024);
  return query;
}
function position(input: unknown): Position {
  requireRule(Array.isArray(input) && input.length === 2);
  const [order, id] = input as unknown[];
  requireRule(typeof order === 'number' && Number.isSafeInteger(order) && order >= 0);
  requireRule(typeof id === 'string' && (id === '' || validatePrimitive('uuid', id).ok));
  requireRule(order === 0 || id !== '');
  return { order, id };
}
export function encodeCursor(cursor: DispatchCursor): string {
  const { installation, lane, upper, after } = cursor;
  const encoded = Buffer.from(JSON.stringify([1, installation, lane, [upper.order, upper.id], [after.order, after.id]])).toString('base64url');
  requireRule(Buffer.byteLength(encoded) <= 1024);
  return encoded;
}
export function decodeCursor(encoded: string, installation: string, lane: DispatchScan['lane']): DispatchCursor {
  try {
    requireRule(encoded.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(encoded));
    const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    requireRule(Array.isArray(decoded) && decoded.length === 5);
    requireRule(decoded[0] === 1 && decoded[1] === installation && decoded[2] === lane);
    const cursor = { installation, lane, upper: position(decoded[3]), after: position(decoded[4]) };
    requireRule(comparePosition(cursor.after, cursor.upper) <= 0 && encodeCursor(cursor) === encoded);
    return cursor;
  } catch { throw new StorageError('invalid_input'); }
}
