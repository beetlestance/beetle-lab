import type { ApiOperation } from '../generated/operations.js';
import type { ApiError, ApiTypes } from '../generated/types.js';
import type { WireFailure, WireResult } from '../../wire-http.js';

export type ApiClientFailure = WireFailure<ApiError>;
export type ApiClientResult<T> = WireResult<T, ApiError>;
type Field<O, K extends string, P extends string> = O extends Record<K, keyof ApiTypes>
  ? { [F in P]: ApiTypes[O[K]] } : object;
export type ApiOperationInput<O extends ApiOperation> = Field<O, 'params', 'params'>
  & Field<O, 'query', 'query'> & Field<O, 'request', 'body'> & { signal?: AbortSignal };
type Method<O extends ApiOperation> = O extends { params: string } | { query: string } | { request: string }
  ? (input: ApiOperationInput<O>) => Promise<ApiClientResult<ApiTypes[O['response']]>>
  : (input?: ApiOperationInput<O>) => Promise<ApiClientResult<ApiTypes[O['response']]>>;
export type ApiClient = { readonly [O in ApiOperation as O['name']]: Method<O> };
