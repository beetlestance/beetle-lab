import { captureHistoricalIdentity } from './historical-native.js';
import { validateHistoricalMode } from './historical.js';
import { checkedBootstrap } from './input.js';
import { StorageError } from './protocol.js';
import type { Bootstrap } from './protocol.js';
export interface MetadataOptions extends Bootstrap {
  readonly readOnly?: true;
  readonly historicalIdentity?: string;
  path: string;
  /** Trusted matched compiled worker entrypoint supplied by the composition root. */
  workerUrl: URL;
  /** Includes in-flight work; maximum 64. Close has one reserved slot. */
  queueLimit?: number;
}
function validateLocation(options: MetadataOptions): void {
  if (typeof options.path !== 'string' || !options.path || options.path === ':memory:' || options.path.length > 4096 ||
    !(options.workerUrl instanceof URL) || options.workerUrl.protocol !== 'file:') throw new StorageError('invalid_input');
}
export function validateOptions(options: MetadataOptions): Bootstrap {
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new StorageError('invalid_input');
  validateLocation(options);
  validateHistoricalMode(options.readOnly, options.runtime); captureHistoricalIdentity(options.readOnly, options.historicalIdentity);
  try { return checkedBootstrap({ installation: options.installation, runtime: options.runtime,
    ...(options.runs === undefined ? {} : { runs: options.runs }),
    ...(options.exports === undefined ? {} : {exports:options.exports}), runtimeTtlMs: options.runtimeTtlMs ?? 5000 }); }
  catch { throw new StorageError('invalid_input'); }
}
