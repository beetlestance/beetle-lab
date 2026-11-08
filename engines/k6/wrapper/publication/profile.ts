import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { encodeJson, verifyEngineResultSeal } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { PublicationError } from './types.js';
import type { PublicationOptions } from './types.js';
type CapturedOptions = Omit<PublicationOptions, 'signal' | 'wallNow'> & {
  readonly signal: AbortSignal | undefined; readonly wallNow: (() => number) | undefined;
};

export interface Profile {
  readonly directory: string;
  readonly uid: number;
  readonly deadlineMs: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly wallNow: () => number;
  readonly value: EngineResult;
  readonly bytes: Buffer;
  readonly rawSha256: string;
}
export function sha256(text: string | Uint8Array): string { return createHash('sha256').update(text).digest('hex'); }
function positive(value: number, max: number): boolean { return Number.isSafeInteger(value) && value >= 1 && value <= max; }
function assertCustody(options: CapturedOptions): void {
  if (typeof options.directory !== 'string' || !isAbsolute(options.directory) || resolve(options.directory) !== options.directory
    || options.directory.includes('\0')) throw new PublicationError('profile');
  if (!Number.isSafeInteger(options.uid) || options.uid < 0 || options.uid !== process.getuid?.()) throw new PublicationError('profile');
}
function assertProfile(options: CapturedOptions): void {
  assertCustody(options);
  if (!positive(options.maximumBytes, 1_048_576)) throw new PublicationError('limit');
  if (!positive(options.timeoutMs, 60_000) || !positive(options.deadlineMs, 8_640_000_000_000_000)) throw new PublicationError('profile');
  if (options.wallNow !== undefined && typeof options.wallNow !== 'function') throw new PublicationError('profile');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new PublicationError('profile');
}
function scopeMatches(options: CapturedOptions, value: EngineResult): void {
  let scope: Record<string, unknown>;
  try { scope = JSON.parse(encodeJson(options.expectedScope, 1024)) as Record<string, unknown>; }
  catch { throw new PublicationError('scope'); }
  const keys = ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== keys.length
    || keys.some(key => scope[key] !== value[key])) throw new PublicationError('scope');
}
/** No clock or IO callbacks occur while capturing and validating the caller's data. */
export function snapshot(input: PublicationOptions): Profile {
  const options = { result: input.result, expectedScope: input.expectedScope, directory: input.directory, uid: input.uid,
    maximumBytes: input.maximumBytes, deadlineMs: input.deadlineMs, timeoutMs: input.timeoutMs,
    signal: input.signal, wallNow: input.wallNow };
  assertProfile(options);
  const checked = verifyEngineResultSeal(options.result, sha256);
  if (!checked.ok || checked.value.engineId !== 'k6') throw new PublicationError('invalid_result');
  scopeMatches(options, checked.value);
  let bytes: Buffer;
  try { bytes = Buffer.from(encodeJson(checked.value, options.maximumBytes - 1) + '\n', 'utf8'); }
  catch { throw new PublicationError('limit'); }
  return Object.freeze({ directory: options.directory, uid: options.uid, deadlineMs: options.deadlineMs,
    timeoutMs: options.timeoutMs, signal: options.signal, wallNow: options.wallNow ?? Date.now,
    value: checked.value, bytes, rawSha256: sha256(bytes) });
}
