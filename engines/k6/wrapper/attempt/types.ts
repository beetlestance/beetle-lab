import type { ControlEvent, EngineResult } from '@beetle/contracts';
import type { MetricWindow } from '../../aggregation/index.js';
import type { ExecutionReceipt } from '../execution/index.js';
import type { InputFailure, OpenStagedOptions } from '../input/index.js';
import type { JournalScope } from '../control/index.js';
import type { PublicationResult } from '../publication/index.js';

/** Trusted packaging arguments. No options are read from the staged payload. */
export interface StagedK6Options extends Omit<OpenStagedOptions, 'wallNow' | 'headerTimeoutMs'> {
  readonly outputRoot: string;
  readonly headerTimeoutMs?: number;
  /** Serial, bounded and cooperative; original callback work remains owned until settled. */
  readonly onEvent?: (event: ControlEvent, signal: AbortSignal) => Promise<void>;
  readonly onWindow?: (window: MetricWindow, signal: AbortSignal) => Promise<void>;
}
export type AttemptReason = 'profile' | 'input' | 'output_limit' | 'journal' | 'compile'
  | 'execution' | 'artifact' | 'mapping' | 'seal' | 'publication' | 'cleanup'
  | 'cancelled' | 'deadline' | 'clock' | 'notification';
export type Quiescence = 'confirmed' | 'unknown' | 'failed' | 'not_started';
export interface StagedK6Receipt {
  /** Healthy coordination and published durable result; never a test verdict. */
  readonly ok: boolean;
  readonly reason: AttemptReason | null;
  readonly scope: JournalScope | null;
  readonly inputFailure: InputFailure | null;
  readonly execution: ExecutionReceipt | null;
  readonly result: EngineResult | null;
  readonly publication: PublicationResult | null;
  readonly quiescence: Readonly<Record<'input' | 'execution' | 'artifacts' | 'journal' | 'publication' | 'notifications', Quiescence>>;
  readonly notifications: 'complete' | 'disabled' | 'failed';
}
export class AttemptError extends Error {
  constructor(readonly reason: AttemptReason) { super(reason); this.name = 'AttemptError'; }
}
