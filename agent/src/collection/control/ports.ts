import { open, lstat, realpath } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

/** Private fault seam; public reader options never select an IO implementation. */
export interface ReaderPorts {
  readonly open: typeof open;
  readonly lstat: typeof lstat;
  readonly realpath: typeof realpath;
  readonly now: () => number;
}
export const nodePorts: ReaderPorts = { open, lstat, realpath, now: () => performance.now() };
