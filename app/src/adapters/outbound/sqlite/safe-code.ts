import { StorageError } from './protocol.js';
import type { ErrorCode } from './protocol.js';
import { SemanticError } from '../../../domain/namespaces/index.js';
export function safeCode(error: unknown): ErrorCode {
  if (error instanceof StorageError || error instanceof SemanticError) return error.code;
  if (typeof error === 'object' && error !== null && 'errcode' in error) {
    if (error.errcode === 5 || error.errcode === 6) return 'owned';
    if (typeof error.errcode === 'number' && (error.errcode & 255) === 19) return 'conflict';
  }
  return 'unavailable';
}
