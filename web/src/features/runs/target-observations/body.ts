import { TARGET_RUNTIME_REPORT_BYTES } from '@beetle/contracts/target-runtime';
import { responseBody } from '../../../lib/response-body.js';
/** Exact retained artifact length over the shared bounded browser stream owner. */
export function targetBody(response: Response, expected: number, signal: AbortSignal): Promise<Uint8Array> {
  return responseBody(response, {maximum: TARGET_RUNTIME_REPORT_BYTES, expected}, signal);
}
