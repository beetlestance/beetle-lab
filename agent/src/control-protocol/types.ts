import type { ControlEvent } from '@beetle/contracts';

export const CONTROL_FILE = 'control.ndjson';
export const CONTROL_FILE_BYTES = 67_108_864;
export const CONTROL_FRAME_BYTES = 65_536;
export const AGENT_EVENT_BYTES = CONTROL_FRAME_BYTES + 512;
export const CONTROL_RECORDS = 65_536;
export const CONTROL_BATCH_BYTES = 262_144;
export const CONTROL_BATCH_EVENTS = 100;
export type ControlScope = Pick<ControlEvent, 'organizationId' | 'workspaceId' | 'attemptId' | 'generation'>;
export interface WrapperCursor {
  readonly version: 1; readonly dev: string; readonly ino: string;
  readonly offset: number; readonly wrapperSeq: number; readonly prefixSha256: string;
}
export interface WrapperCheckpoint extends WrapperCursor { readonly lastBatchDigest: string }
export interface WrapperBatch {
  readonly key: Readonly<ControlScope>;
  readonly expected: Readonly<WrapperCheckpoint> | null;
  readonly next: Readonly<WrapperCursor>;
  readonly events: readonly ControlEvent[];
}
