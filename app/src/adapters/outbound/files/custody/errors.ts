export type FileCustodyErrorCode = 'custody_missing' | 'invalid_input' | 'cancelled' | 'integrity' | 'io' | 'cleanup' | 'capacity_unavailable';
export class FileCustodyError extends Error {
  constructor(readonly code: FileCustodyErrorCode) { super('File custody operation failed'); this.name = 'FileCustodyError'; }
}
export function fail(code: FileCustodyErrorCode): never { throw new FileCustodyError(code); }
export function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}
