import type { Scope } from '../admission/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';

export interface OutputScanRequest {
  readonly key: Scope;
  readonly plan: RuntimePlan;
  readonly outputBytes: number;
  readonly minimumFreeBytes: number;
}
export type OutputScanReason = 'invalid_input' | 'busy' | 'cancelled' | 'deadline' | 'io' | 'custody' | 'bounds' | 'cleanup';
export type OutputScanResult =
  | { readonly kind: 'known'; readonly startedAt: number; readonly logicalBytes: number;
    readonly allocatedBytes: number; readonly chargedBytes: number; readonly freeBytes: number }
  | { readonly kind: 'limit'; readonly startedAt: number; readonly reason: 'output' | 'disk' }
  | { readonly kind: 'unknown'; readonly reason: OutputScanReason };
