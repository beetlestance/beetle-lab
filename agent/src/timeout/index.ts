export type { TimeoutGuard, TimeoutWatch, TimeoutRequest, TimeoutOptions, TimeoutReason, TimeoutStatus } from './types.js';
export { TimeoutError } from './types.js';
import type { TimeoutGuard, TimeoutOptions } from './types.js';
import { TimeoutService } from './service.js';
export function createTimeoutGuard(options: TimeoutOptions): TimeoutGuard { return new TimeoutService(options); }
