import { OutputByteError } from '../../ports/output-bytes.js';
import { OutputSourceError } from '@beetle/contracts/output-source';
import { OutputTransferError } from '../../ports/output-transfer.js';
import type { OutputTransferCode } from '../../ports/output-transfer.js';

export function fail(code: OutputTransferCode): never { throw new OutputTransferError(code); }
export function requireTransfer(condition: unknown, code: OutputTransferCode = 'integrity'): asserts condition {
  if (!condition) fail(code);
}
export function safeError(error: unknown): OutputTransferError {
  try { return classify(error); } catch { return new OutputTransferError('storage'); }
}
function classify(error: unknown): OutputTransferError {
  if (error instanceof OutputTransferError) return transferError(error);
  if (error instanceof OutputSourceError) return new OutputTransferError('integrity');
  if (error instanceof OutputByteError) {
    switch (error.code) {
      case 'cleanup': return new OutputTransferError('cleanup');
      case 'cancelled': case 'deadline': return new OutputTransferError('cancelled');
      case 'integrity': case 'custody_missing': return new OutputTransferError('integrity');
      default: return new OutputTransferError('storage');
    }
  }
  if (error instanceof Error) {
    return metadataError(error);
  }
  return new OutputTransferError('storage');
}
function transferError(error: OutputTransferError): OutputTransferError {
  const codes: readonly OutputTransferCode[] = ['invalid_input', 'busy', 'closed', 'cancelled', 'source_unavailable',
    'transport', 'conflict', 'integrity', 'storage', 'cleanup'];
  return new OutputTransferError(codes.includes(error.code) ? error.code : 'storage');
}
function metadataError(error: Error): OutputTransferError {
  const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  return new OutputTransferError(code === 'conflict' ? 'conflict' : 'storage');
}
