import { validatePrimitive } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { captureCollectionRootIdentity } from '../root/index.js';
import { OutputFailure } from './ports.js';
import { OUTPUT_READ_BYTES } from './types.js';
import type { OutputRangeOptions } from './range-types.js';

function own(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new OutputFailure('invalid_options');
  return descriptor.value;
}
function artifact(input: unknown): Readonly<Artifact> {
  if (input === null || typeof input !== 'object') throw new OutputFailure('invalid_options');
  const names = ['artifactId', 'kind', 'relativePath', 'bytes', 'sha256', 'sealedAt'];
  if (Reflect.ownKeys(input).length !== names.length) throw new OutputFailure('invalid_options');
  const value: Record<string, unknown> = {};
  for (const name of names) {
    const scalar = own(input, name);
    if (typeof scalar !== (name === 'bytes' ? 'number' : 'string')) throw new OutputFailure('invalid_options');
    if (typeof scalar === 'string' && scalar.length > 4096) throw new OutputFailure('invalid_options');
    value[name] = scalar;
  }
  const checked = validatePrimitive('artifact', value);
  if (!checked.ok) throw new OutputFailure('invalid_options');
  return Object.freeze(checked.value);
}
function integer(input: unknown, maximum: number, minimum = 0): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= minimum && input <= maximum;
}
function signal(input: unknown): AbortSignal | undefined {
  if (input === undefined || input instanceof AbortSignal) return input;
  throw new OutputFailure('invalid_options');
}
/** Admission precedes every descriptor trap; captured fields never invoke accessors. */
export function snapshotRange(input: OutputRangeOptions): OutputRangeOptions {
  try {
    const root = captureCollectionRootIdentity(own(input, 'root'));
    const declaration = artifact(own(input, 'artifact'));
    const offset = own(input, 'offset'); const length = own(input, 'length');
    const deadline = own(input, 'deadline'); const stop = signal(own(input, 'signal'));
    if (!integer(offset, declaration.bytes) || !integer(length, OUTPUT_READ_BYTES, 1)) throw new OutputFailure('invalid_options');
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) throw new OutputFailure('invalid_options');
    return Object.freeze({ root, artifact: declaration, offset, length, deadline, ...(stop === undefined ? {} : { signal: stop }) });
  } catch { throw new OutputFailure('invalid_options'); }
}
