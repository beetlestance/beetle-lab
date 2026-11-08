import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { OutputCollectionReason } from './types.js';

export class OutputFailure extends Error {
  constructor(readonly reason: OutputCollectionReason) { super(`Output collection ${reason}`); }
}
export interface OutputPorts {
  readonly lstat: typeof lstat; readonly open: typeof open; readonly realpath: typeof realpath;
  readonly now: () => number;
}
export const nodePorts: OutputPorts = { lstat, open, realpath, now: () => performance.now() };
export interface OutputIO {
  check(): void;
  io<T>(action: () => Promise<T>): Promise<T>;
  own(handle: FileHandle): void;
  closeHandles(handles: readonly FileHandle[]): Promise<void>;
}
