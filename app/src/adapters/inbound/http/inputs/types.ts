import type { onRequestAsyncHookHandler } from 'fastify';
import type { InputService } from '../../../../ports/input-service.js';

export interface InputRouteOptions {
  readonly inputs: InputService;
  readonly authorize: onRequestAsyncHookHandler;
  readonly newId: () => string;
}
export interface InputHttp {
  /** Synchronously fences intake/aborts owned streams, then drains issued operations.
   * Bootstrap separately closes InputService; neither response close nor a deadline
   * proves native descriptor cleanup or metadata settlement.
   */
  close(): Promise<void>;
}
