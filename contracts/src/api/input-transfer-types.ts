import type { ApiClientFailure } from './client/types.js';
import type { InputRecord } from './generated/types.js';

export interface InputTransferOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** 1..30,000ms, default 30,000; abort deadline, not proof of original settlement. */
  readonly timeoutMs?: number;
}
export interface InputTransferRequest {
  readonly record: InputRecord;
  readonly signal?: AbortSignal;
}
export interface InputAppendRequest extends InputTransferRequest {
  readonly offset: number;
  readonly chunk: Uint8Array;
}
export type InputTransferFailure = ApiClientFailure | { readonly kind: 'busy' | 'closed' };
export type InputTransferResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: InputTransferFailure; readonly issued: boolean };

/** JSON create/status/seal/delete remain in ApiClient. No write retries here. */
export interface InputTransferClient {
  append(request: InputAppendRequest): Promise<InputTransferResult<InputRecord>>;
  download(request: InputTransferRequest): Promise<InputTransferResult<Uint8Array>>;
  /** Fences intake, aborts network work and drains every issued original. */
  close(): Promise<void>;
}
