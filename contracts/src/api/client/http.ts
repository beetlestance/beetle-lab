import { createWireTransport } from '../../wire-http.js';
import type { HttpOptions, WireTransport } from '../../wire-http.js';
import type { ApiError, ApiTypes } from '../generated/types.js';
import { validateApi } from '../validate.js';
import { API_MAXIMUM_JSON_BYTES } from '../limits.js';

export type ApiHttpOptions = HttpOptions;
export type ApiTransport = WireTransport<ApiTypes, ApiError>;

/** Fixed public API namespace; bounds, deadlines and no retries belong to the shared transport. */
export function createApiHttpTransport(options: ApiHttpOptions): ApiTransport {
  return createWireTransport<ApiTypes, ApiError>({ ...options, maximumBytes: options.maximumBytes ?? API_MAXIMUM_JSON_BYTES }, {
    pathPrefix: '/api/v2/', responseMaximumBytes: {RetentionTraversalPage:40960,RetentionPreview:32768,RetentionBatchStatus:32768,RetentionBatchList:8192,RetentionApplyReceipt:2048,RetentionDiscardReceipt:2048,LiveMetricSnapshot: 65536, RunComparisonSnapshot: 262144}, validate: validateApi,
    validateError: input => validateApi('ApiError', input),
  });
}
