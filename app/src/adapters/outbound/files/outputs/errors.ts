import { OutputByteError } from '../../../../ports/output-bytes.js';
import type { OutputByteErrorCode } from '../../../../ports/output-bytes.js';
import { FileCustodyError } from '../custody/index.js';
import { OutputLeaseError } from './lease.js';

export function fail(code: OutputByteErrorCode): never { throw new OutputByteError(code); }
export function safeError(error: unknown): OutputByteError {
  if (error instanceof OutputByteError) return error;
  if (error instanceof FileCustodyError) return new OutputByteError(error.code);
  if (error instanceof OutputLeaseError) return new OutputByteError(error.code === 'owned' ? 'busy' : error.code);
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const codes: Record<string, OutputByteErrorCode> = { ENOSPC: 'capacity_unavailable', ENOENT: 'custody_missing', ELOOP: 'integrity' };
    if (typeof error.code === 'string') return new OutputByteError(codes[error.code] ?? 'io');
  }
  return new OutputByteError('io');
}
