import type { LiveMetricScope, LiveMetricSnapshot, LiveMetricSubset } from '@beetle/contracts/api';
import type { MailboxArchiveReply, Operation } from '../backends/docker/index.js';
/** Supplied by trusted compile/launch authority, never inferred from a received frame. */
export interface LiveMetricApproval {
  readonly scope: LiveMetricScope;
  readonly producerEpoch: string;
  readonly subset: LiveMetricSubset;
}
export interface LiveMetricReaderOptions {
  readonly approval: LiveMetricApproval;
  /** This port owns the actual HTTP request/response originals through physical close. */
  read(operation: Operation): Promise<MailboxArchiveReply>;
  readonly clock?: {wall(): number; monotonic(): number};
}
export type LiveMetricReadFailure = 'invalid_input' | 'busy' | 'closed' | 'unavailable' | 'deadline'
  | 'aborted' | 'scope' | 'epoch' | 'subset' | 'ordering' | 'stale' | 'clock';
export type LiveMetricRead = {readonly ok: true; readonly frame: LiveMetricSnapshot}
  | {readonly ok: false; readonly reason: LiveMetricReadFailure};
