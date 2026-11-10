import { FileCustodyError } from '../custody/index.js';

export type OutputLeaseErrorCode = 'invalid_input' | 'owned' | 'closed' | 'integrity' | 'io' | 'cleanup';
export class OutputLeaseError extends Error {
  constructor(readonly code: OutputLeaseErrorCode) { super('Output namespace lease failed'); this.name = 'OutputLeaseError'; }
}
export function fail(code: OutputLeaseErrorCode): never { throw new OutputLeaseError(code); }
function nativeError(error: object): OutputLeaseError {
  if ('errcode' in error && typeof error.errcode === 'number') {
    const codes = new Map<number, OutputLeaseErrorCode>([[5, 'owned'], [6, 'owned'], [11, 'integrity'], [26, 'integrity']]);
    return new OutputLeaseError(codes.get(error.errcode) ?? 'io');
  }
  if ('code' in error && typeof error.code === 'string' && ['ENOENT', 'ELOOP'].includes(error.code)) {
    return new OutputLeaseError('integrity');
  }
  return new OutputLeaseError('io');
}
export function translated(error: unknown): OutputLeaseError {
  if (error instanceof OutputLeaseError) return error;
  if (error instanceof FileCustodyError) return new OutputLeaseError(error.code === 'invalid_input' ? 'invalid_input' : 'integrity');
  return error !== null && typeof error === 'object' ? nativeError(error) : new OutputLeaseError('io');
}
