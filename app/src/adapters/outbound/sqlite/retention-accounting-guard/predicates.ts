import type { Prepared, ReservationFrame, Frame, ApplyFrame, CompletionFrame } from './types.js';
export function tuple(value: Prepared['before']) {
  return JSON.stringify([1, value.epoch_count, value.snapshot_count, value.charged_bytes, value.clock_ms]);
}
export interface Insert {
  readonly kind: unknown;
  readonly organization: unknown;
  readonly workspace: unknown;
  readonly id: unknown;
  readonly body: unknown;
}
export function epochAllowed(f: ReservationFrame, input: Insert): number {
  return f.phase === 'epoch' &&
    f.prepared.newEpoch &&
    input.id === f.prepared.snapshot.scope.workspaceId &&
    input.body === null
    ? 1
    : 0;
}
export function usageAllowed(f: Exclude<Frame, ApplyFrame | CompletionFrame>, before: unknown, after: unknown): number {
  return f.phase === 'usage' &&
    before === JSON.stringify([1, f.prepared.usage[0]]) &&
    after === JSON.stringify([1, f.prepared.usage[1]])
    ? 1
    : 0;
}
