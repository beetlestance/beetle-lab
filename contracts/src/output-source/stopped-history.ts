import { decodeLiveMetricHistory, encodeLiveMetricHistory, LIVE_HISTORY_BYTES } from '../api/live-history.js';
import type { LiveMetricHash } from '../api/live-metrics.js';
import { encodeCanonicalJson } from '../json.js';
import type { OutputAbsence } from '../generated/types.js';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES } from './absence.js';
import type { AbsenceIdentity } from './absence.js';
import type { Owned } from './types.js';

export const STOPPED_HISTORY_ENVELOPE_BYTES = LIVE_HISTORY_BYTES + OUTPUT_ABSENCE_BYTES + 512;

export interface StoppedObservation {
  readonly json: string;
  readonly digest: string;
  readonly bytes: number;
}
export interface StoppedHistoryClosure {
  readonly absence: Owned<OutputAbsence>;
  readonly observation: StoppedObservation | null;
}
const rejected = () => new Error('Stopped history reply rejected');
function field(object: unknown, key: string): unknown {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw rejected();
  const entry = Object.getOwnPropertyDescriptor(object, key);
  if (!entry?.enumerable || !('value' in entry)) throw rejected();
  return entry.value;
}
function fields(object: unknown, keys: readonly string[]): void {
  if (!object || typeof object !== 'object' || Reflect.ownKeys(object).length !== keys.length) throw rejected();
  for (const key of keys) field(object, key);
}
function observed(proof: OutputAbsence, text: string, metadata: unknown, hash: LiveMetricHash): StoppedObservation {
  if (proof.admission.state !== 'released' || proof.admission.disposition !== 'settled' || proof.finalAgentSeq < 1)
    throw rejected();
  const digest = hash(text);
  const bytes = new TextEncoder().encode(text).length;
  if (!/^[a-f0-9]{64}$/.test(digest) || digest !== field(metadata, 'digest') || bytes !== field(metadata, 'bytes'))
    throw rejected();
  return { json: text, digest, bytes };
}

/** Verify the companion read against the exact authenticated runner attempt. */
export function captureStoppedHistoryClosure(
  input: unknown,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): StoppedHistoryClosure {
  fields(input, ['absence', 'observation']);
  const absence = captureOutputAbsence(field(input, 'absence'), expected);
  const observation = field(input, 'observation');
  if (observation === null) return { absence, observation: null };
  fields(observation, ['history', 'digest', 'bytes']);
  const bytes = encodeLiveMetricHistory(field(observation, 'history'), hash, expected);
  return { absence, observation: observed(absence, new TextDecoder().decode(bytes), observation, hash) };
}

/** Insert the verified canonical JSON as a value so transport does not double-escape the payload. */
export function encodeStoppedHistoryClosure(
  input: StoppedHistoryClosure,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): string {
  const absence = captureOutputAbsence(input.absence, expected);
  const proof = encodeCanonicalJson(absence, OUTPUT_ABSENCE_BYTES);
  if (input.observation === null) return `{"absence":${proof},"observation":null}`;
  const { json } = input.observation;
  if (typeof json !== 'string' || json.length > LIVE_HISTORY_BYTES) throw rejected();
  const bytes = new TextEncoder().encode(json);
  const parsed = decodeLiveMetricHistory(bytes, hash);
  if (new TextDecoder().decode(encodeLiveMetricHistory(parsed, hash, expected)) !== json) throw rejected();
  const observation = observed(absence, json, input.observation, hash);
  return `{"absence":${proof},"observation":{"bytes":${observation.bytes},"digest":"${observation.digest}","history":${json}}}`;
}
