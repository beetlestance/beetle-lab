import { createWireTransport } from '../../wire-http.js';
import type { HttpOptions, WireTransport } from '../../wire-http.js';
import type { ApiError, ApiTypes } from '../generated/types.js';
import { validateApi } from '../validate.js';

export type ApiHttpOptions = HttpOptions;
export type ApiTransport = WireTransport<ApiTypes, ApiError>;

/** Fixed public API namespace; bounds, deadlines and no retries belong to the shared transport. */
export function createApiHttpTransport(options: ApiHttpOptions): ApiTransport {
  return createWireTransport<ApiTypes, ApiError>(options, {
    pathPrefix: '/api/v2/', validate: validateApi,
    validateError: input => validateApi('ApiError', input),
  });
}
