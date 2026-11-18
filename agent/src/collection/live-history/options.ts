import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureLiveMetricSnapshot, liveMetricScopeMatches, validateApi } from '@beetle/contracts/api';
import type { LiveMetricScope, LiveMetricSnapshot } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
export interface PrefixReadOptions {
  readonly directory: string;
  readonly uid: number;
  /** Independently resolved active attempt, never learned from the received frame. */
  readonly scope: LiveMetricScope;
  /** Caller has already matched the installed producer approval and epoch. */
  readonly frame: LiveMetricSnapshot;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}
function own(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new OutputFailure('invalid_options');
  return descriptor.value;
}
function detached(input: unknown, maximum: number): unknown {
  return JSON.parse(encodeCanonicalJson(input, maximum)) as unknown;
}
export function captureOptions(input: PrefixReadOptions, now: number) {
  try {
    const directory = directoryValue(own(input, 'directory'));
    const uid = uidValue(own(input, 'uid'));
    const deadline = deadlineValue(own(input, 'deadline'), now);
    const signal = signalValue(own(input, 'signal'));
    const scope = validateApi('LiveMetricScope', detached(own(input, 'scope'), 1024));
    const frame = captureLiveMetricSnapshot(detached(own(input, 'frame'), 65536), (value) =>
      createHash('sha256').update(value).digest('hex'),
    );
    if (!scope.ok || !frame.archivePrefix || !liveMetricScopeMatches(frame.scope, scope.value)) throw Error();
    return {
      directory,
      uid,
      deadline,
      scope: scope.value,
      frame,
      prefix: frame.archivePrefix,
      ...(signal === undefined ? {} : { signal }),
    };
  } catch {
    throw new OutputFailure('invalid_options');
  }
}
export type CapturedOptions = ReturnType<typeof captureOptions>;

function directoryValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.endsWith('/') ||
    value.includes('\0') ||
    Buffer.byteLength(value) > 4096 ||
    !isAbsolute(value) ||
    normalize(value) !== value
  )
    throw Error();
  return value;
}
function uidValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 4294967295) throw Error();
  return value;
}
function deadlineValue(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(now) || value - now > 30000)
    throw Error();
  return value;
}
function signalValue(value: unknown): AbortSignal | undefined {
  if (value !== undefined && !(value instanceof AbortSignal)) throw Error();
  return value;
}
