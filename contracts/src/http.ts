import { EXPORT_ASSIGNMENT_BYTES } from './export-job/index.js';
import type { ProtocolTypes, ProtocolError } from './generated/types.js';
import { validate } from './validate.js';
import type { ProtocolName } from './validate.js';
import { createWireTransport } from './wire-http.js';
import { RUNNER_MAXIMUM_OFFER_BYTES } from './limits.js';
import { SOURCE_CHUNK_REQUEST_BYTES } from './output-source/wire-limits.js';
import type { HttpOptions, WireCall, WireFailure, WireResult, WireTransport } from './wire-http.js';

export type ClientFailure = WireFailure<ProtocolError>;
export type ClientResult<T> = WireResult<T, ProtocolError>;
export type JsonCall<N extends ProtocolName> = WireCall<N, ProtocolName>;
export type RunnerTransport = WireTransport<ProtocolTypes, ProtocolError>;
export type { HttpOptions } from './wire-http.js';

/** Fixed runner namespace; no retries or credential-bearing cross-origin calls. */
export function createHttpTransport(options: HttpOptions): RunnerTransport {
  return createWireTransport(options, { pathPrefix: '/runner/v1/', validate,
    requestMaximumBytes: { Offer: RUNNER_MAXIMUM_OFFER_BYTES, StandaloneExportAssignment: EXPORT_ASSIGNMENT_BYTES, SourceChunkRequest: SOURCE_CHUNK_REQUEST_BYTES },
    validateError: input => validate('ProtocolError', input) });
}
