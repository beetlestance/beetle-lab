import { encodeCanonicalJson, jsonNodeCount } from '../json.js';
import { validateApi } from './validate.js';
import {
  captureLiveMetricSubset,
  liveMetricSubsetText,
  liveMetricArchivePrefixMatches,
  liveMetricSeriesMatch,
  liveMetricScopeMatches,
} from './live-metrics.js';
import type { LiveMetricHash } from './live-metrics.js';
import type { LiveMetricHistory, LiveMetricScope } from './generated/types.js';
import { API_MAXIMUM_JSON_BYTES } from './limits.js';
export const LIVE_HISTORY_BYTES = API_MAXIMUM_JSON_BYTES;
export class LiveHistoryError extends Error {
  constructor() {
    super('Live history rejected');
    this.name = 'LiveHistoryError';
  }
}
/** Advisory sampled source windows, not sealed publication or crash durability. */
export function captureLiveMetricHistory(input: unknown, hash: LiveMetricHash): LiveMetricHistory {
  try {
    return checkedHistory(JSON.parse(encodeCanonicalJson(input, LIVE_HISTORY_BYTES)), hash);
  } catch {
    throw new LiveHistoryError();
  }
}
function checkedHistory(input: unknown, hash: LiveMetricHash): LiveMetricHistory {
  const checked = validateApi('LiveMetricHistory', input);
  if (!checked.ok) throw new LiveHistoryError();
  const value = checked.value;
  const subset = captureLiveMetricSubset(value.subset);
  if (
    !liveMetricArchivePrefixMatches(value.prefix, value.scope) ||
    value.subsetDigest !== hash(liveMetricSubsetText(subset)) ||
    value.sampled !== value.samples.length < value.prefix.windows ||
    value.samples.length > value.prefix.windows ||
    !samplesMatch(value, subset)
  )
    throw new LiveHistoryError();
  return { ...value, subset };
}
export function encodeLiveMetricHistory(input: unknown, hash: LiveMetricHash, scope?: LiveMetricScope): Uint8Array {
  try {
    const text = encodeCanonicalJson(input, LIVE_HISTORY_BYTES);
    const value = checkedHistory(JSON.parse(text), hash);
    if (scope && !liveMetricScopeMatches(value.scope, scope)) throw new LiveHistoryError();
    return new TextEncoder().encode(text);
  } catch {
    throw new LiveHistoryError();
  }
}
export function decodeLiveMetricHistory(bytes: Uint8Array, hash: LiveMetricHash): LiveMetricHistory {
  try {
    if (bytes.byteLength > LIVE_HISTORY_BYTES) throw new LiveHistoryError();
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    jsonNodeCount(parsed);
    return checkedHistory(parsed, hash);
  } catch {
    throw new LiveHistoryError();
  }
}

function samplesMatch(value: LiveMetricHistory, subset: LiveMetricHistory['subset']): boolean {
  let previousEnd = -1;
  let previousSequence = 0;
  for (let index = 0; index < value.samples.length; index++) {
    const sample = value.samples[index]!;
    if (
      sample.sequence <= previousSequence ||
      sample.sequence > value.prefix.windows ||
      sample.endTimeMs - sample.startTimeMs !== 1000 ||
      sample.startTimeMs < previousEnd ||
      !liveMetricSeriesMatch({ ...sample, subset })
    )
      return false;
    previousEnd = sample.endTimeMs;
    previousSequence = sample.sequence;
  }
  return (
    value.samples[0]!.sequence === 1 &&
    value.samples.at(-1)!.sequence === value.prefix.windows &&
    previousEnd === value.prefix.endTimeMs
  );
}
