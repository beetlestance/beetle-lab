import { encodeJson } from '@beetle/contracts';
export interface NativeDirectoryFact {
  readonly dev: string; readonly ino: string; readonly uid: string; readonly gid: string; readonly mode: string;
}
export interface NativeFileFact extends NativeDirectoryFact { readonly bytes: string; readonly links: '1' }
const directoryFields = ['dev', 'ino', 'uid', 'gid', 'mode'];
function scalar(value: unknown, maximum: bigint): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= maximum;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const copy = JSON.parse(encodeJson(value, 1024)) as unknown;
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('Invalid native fact');
  const row = copy as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) throw new Error('Invalid native fact');
  return row;
}
function nativeFields(row: Record<string, unknown>): NativeDirectoryFact {
  if (!scalar(row.dev, 0xffffffffffffffffn) || !scalar(row.ino, 0xffffffffffffffffn) || row.ino === '0') throw new Error('Invalid native identity');
  for (const key of ['uid', 'gid', 'mode']) if (!scalar(row[key], 0xffffffffn)) throw new Error('Invalid native ownership');
  return { dev: row.dev, ino: row.ino, uid: row.uid as string, gid: row.gid as string, mode: row.mode as string };
}
export function captureNativeDirectory(value: unknown): NativeDirectoryFact {
  const fact = nativeFields(record(value, directoryFields));
  if ((BigInt(fact.mode) & 0o170000n) !== 0o040000n) throw new Error('Invalid native directory');
  return fact;
}
export function captureNativeFile(value: unknown): NativeFileFact {
  const row = record(value, [...directoryFields, 'bytes', 'links']); const fact = nativeFields(row);
  if ((BigInt(fact.mode) & 0o170000n) !== 0o100000n || !scalar(row.bytes, 0xffffffffffffffffn) || row.links !== '1') throw new Error('Invalid native file');
  return { ...fact, bytes: row.bytes, links: '1' };
}
