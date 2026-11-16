import type { ApiClientFailure, ApiClientResult } from '@beetle/contracts/api';

export class ApiFailure extends Error {
  constructor(readonly failure: ApiClientFailure) { super(errorMessage(failure)); }
}
export async function readResult<T>(result: Promise<ApiClientResult<T>>): Promise<T> {
  const reply = await result;
  if (!reply.ok) throw new ApiFailure(reply.error);
  return reply.value;
}
export function unknownOutcome(failure: ApiClientFailure) {
  const status = failure.status ?? 0;
  // A structured server error can follow a committed write; retryable is not a receipt.
  if (failure.kind === 'protocol') return status >= 500 && status < 600;
  return ['transport', 'timeout', 'cancelled', 'response'].includes(failure.kind);
}
export function errorMessage(failure: ApiClientFailure): string {
  if (failure.protocol) return failure.protocol.message;
  const messages = {
    request: 'Check the entered values and try again.',
    response: 'The service returned an unreadable response.',
    transport: 'The service is unavailable. Check that the backend is running.',
    timeout: 'The service did not respond in time.',
    cancelled: 'The request was interrupted.',
    protocol: 'The service could not complete the request.',
  };
  return messages[failure.kind];
}
