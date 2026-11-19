import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { encodeCanonicalJson } from '@beetle/contracts';
import {
  captureLiveMetricSnapshot,
  captureLiveMetricSubset,
  liveMetricScopeMatches,
  validateApi,
} from '@beetle/contracts/api';
import type { LiveMetricScope, LiveMetricSnapshot } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
import { captureCollectionRootIdentity } from '../root/index.js';
import type { CollectionRootIdentity } from '../root/index.js';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';

export interface StoppedPrefixReadOptions {
  readonly root: CollectionRootIdentity;
  /** Internal caller must independently prove the producer stopped and derive this approval. */
  readonly approval: K6LiveApproval;
  readonly maximumBytes: number;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}
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
      prefix: frame.archivePrefix,
      producerEpoch: frame.producerEpoch,
      subset: frame.subset,
      subsetDigest: frame.subsetDigest,
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

export function captureStoppedOptions(input: StoppedPrefixReadOptions, now: number) {
  try {
    const root = captureCollectionRootIdentity(own(input, 'root'));
    const deadline = deadlineValue(own(input, 'deadline'), now);
    const signal = signalValue(own(input, 'signal'));
    const maximumBytes = own(input, 'maximumBytes');
    if (typeof maximumBytes !== 'number' || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw Error();
    const approval = captureApproval(detached(own(input, 'approval'), 16384));
    return {
      directory: directoryValue(root.directory),
      uid: root.uid,
      root,
      approval,
      maximumBytes,
      deadline,
      ...(signal === undefined ? {} : { signal }),
    };
  } catch {
    throw new OutputFailure('invalid_options');
  }
}
function captureApproval(input: unknown): K6LiveApproval {
  const value = input as Partial<K6LiveApproval>;
  const scope = validateApi('LiveMetricScope', value.scope);
  const epoch = validateApi('Uuid', value.producerEpoch);
  const interval = value.targetIntervalMs;
  if (!scope.ok || !epoch.ok || !validTargetInterval(interval)) throw Error();
  return {
    scope: scope.value,
    producerEpoch: epoch.value,
    subset: captureLiveMetricSubset(value.subset),
    targetIntervalMs: interval,
  };
}
function validTargetInterval(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 60000);
}
