import { encodeCanonicalJson } from '../json.js';
import { validate } from '../validate.js';
import type { LoadWarningArtifact } from '../generated/types.js';
export type K6WarningArtifact = LoadWarningArtifact;
export type NativeWarnings = K6WarningArtifact['native'];
export const K6_WARNING_BYTES = 4096;
export class K6WarningError extends Error {
  constructor() { super('Warning evidence rejected'); this.name = 'K6WarningError'; }
}
export function captureK6Warnings(input: unknown): K6WarningArtifact {
  try {
    const detached: unknown = JSON.parse(encodeCanonicalJson(input, K6_WARNING_BYTES - 1));
    const checked = validate('LoadWarningArtifact', detached);
    if (!checked.ok) throw new K6WarningError();
    const value = checked.value; const {native, configuration, iteration} = value;
    checkNative(native); checkConfiguration(configuration);
    if (iteration && (iteration.lower > iteration.estimate || iteration.upper < iteration.estimate)) throw new K6WarningError();
    Object.freeze(value.scope); Object.freeze(native); Object.freeze(configuration.arrival); Object.freeze(configuration); Object.freeze(iteration);
    return Object.freeze(value);
  } catch { throw new K6WarningError(); }
}
export function decodeK6Warnings(bytes: Uint8Array): K6WarningArtifact {
  if (!(bytes instanceof Uint8Array) || bytes.length > K6_WARNING_BYTES) throw new K6WarningError();
  try { return captureK6Warnings(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))); }
  catch { throw new K6WarningError(); }
}

function checkNative(native: NativeWarnings): void {
  if (native.coverage === 'complete' && (native.otherWarnings || native.discardedSegments)) throw new K6WarningError();
}
function checkConfiguration(configuration: K6WarningArtifact['configuration']): void {
  if (!configuration.arrival) return;
  if (configuration.scenarioCount !== 1 || configuration.arrival.preAllocatedVUs > configuration.arrival.maxVUs) throw new K6WarningError();
}
