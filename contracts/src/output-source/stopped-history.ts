import { decodeLiveMetricHistory, encodeLiveMetricHistory, LIVE_HISTORY_BYTES } from '../api/live-history.js';
import type { LiveMetricHash } from '../api/live-metrics.js';
import { encodeCanonicalJson } from '../json.js';
import type { OutputAbsence } from '../generated/types.js';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES } from './absence.js';
import type { AbsenceIdentity } from './absence.js';
import type { OutputDeliveryClosure, Owned } from './types.js';
import { capture, fields as exactFields, requireInput } from './capture.js';
import { integer, sameScope, scope, sha } from './shape.js';

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
export interface StoppedDeliveryHistory {
  readonly delivery: OutputDeliveryClosure;
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
function observed(text: string, metadata: unknown, hash: LiveMetricHash): StoppedObservation {
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
  if (
    absence.admission.state !== 'released' ||
    absence.admission.disposition !== 'settled' ||
    absence.finalAgentSeq < 1
  )
    throw rejected();
  return { absence, observation: captureWireObservation(observation, expected, hash) };
}

function captureWireObservation(input: unknown, expected: AbsenceIdentity, hash: LiveMetricHash): StoppedObservation {
  fields(input, ['history', 'digest', 'bytes']);
  const bytes = encodeLiveMetricHistory(field(input, 'history'), hash, expected);
  return observed(new TextDecoder().decode(bytes), input, hash);
}

function encodeObservation(input: StoppedObservation | null, expected: AbsenceIdentity, hash: LiveMetricHash): string {
  if (input === null) return 'null';
  const { json, digest, bytes } = captureStoredStoppedObservation(input, expected, hash);
  return `{"bytes":${bytes},"digest":"${digest}","history":${json}}`;
}

/** Insert the verified canonical JSON as a value so transport does not double-escape the payload. */
export function encodeStoppedHistoryClosure(
  input: StoppedHistoryClosure,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): string {
  const absence = captureOutputAbsence(input.absence, expected);
  const proof = encodeCanonicalJson(absence, OUTPUT_ABSENCE_BYTES);
  if (
    input.observation !== null &&
    (absence.admission.state !== 'released' || absence.admission.disposition !== 'settled' || absence.finalAgentSeq < 1)
  )
    throw rejected();
  return `{"absence":${proof},"observation":${encodeObservation(input.observation, expected, hash)}}`;
}

function captureDelivery(input: unknown, expected: AbsenceIdentity): OutputDeliveryClosure {
  const value = exactFields(capture(input, OUTPUT_ABSENCE_BYTES), 'version,receipt,finalAgentSeq');
  const receipt = exactFields(value.receipt, 'version,key,journalAuthority,sourceDigest,manifestDigest');
  requireInput(value.version === 1 && receipt.version === 1 && receipt.journalAuthority === expected.journalAuthority);
  const key = scope(receipt.key);
  sameScope(key, expected);
  integer(value.finalAgentSeq);
  sha(receipt.sourceDigest);
  sha(receipt.manifestDigest);
  return {
    version: 1,
    finalAgentSeq: value.finalAgentSeq,
    receipt: {
      version: 1,
      key,
      journalAuthority: expected.journalAuthority,
      sourceDigest: receipt.sourceDigest,
      manifestDigest: receipt.manifestDigest,
    },
  };
}

export function captureStoppedDeliveryHistory(
  input: unknown,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): StoppedDeliveryHistory {
  fields(input, ['delivery', 'intentDigest', 'observation']);
  if (field(input, 'intentDigest') !== expected.intentDigest) throw rejected();
  const delivery = captureDelivery(field(input, 'delivery'), expected);
  const observation = field(input, 'observation');
  if (observation === null) return { delivery, observation: null };
  if (delivery.finalAgentSeq < 1) throw rejected();
  return { delivery, observation: captureWireObservation(observation, expected, hash) };
}

export function encodeStoppedDeliveryHistory(
  input: StoppedDeliveryHistory,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): string {
  const delivery = captureDelivery(input.delivery, expected);
  if (delivery.finalAgentSeq < 1 && input.observation !== null) throw rejected();
  sha(expected.intentDigest);
  const proof = encodeCanonicalJson(delivery, OUTPUT_ABSENCE_BYTES);
  return `{"delivery":${proof},"intentDigest":"${expected.intentDigest}","observation":${encodeObservation(input.observation, expected, hash)}}`;
}

export function captureStoredStoppedObservation(
  input: unknown,
  expected: AbsenceIdentity,
  hash: LiveMetricHash,
): StoppedObservation {
  fields(input, ['json', 'digest', 'bytes']);
  const text = field(input, 'json');
  if (typeof text !== 'string' || text.length > LIVE_HISTORY_BYTES) throw rejected();
  const bytes = new TextEncoder().encode(text);
  const value = decodeLiveMetricHistory(bytes, hash);
  if (new TextDecoder().decode(encodeLiveMetricHistory(value, hash, expected)) !== text) throw rejected();
  const digest = hash(text);
  if (!/^[a-f0-9]{64}$/.test(digest) || digest !== field(input, 'digest') || bytes.length !== field(input, 'bytes'))
    throw rejected();
  return { json: text, digest, bytes: bytes.length };
}
