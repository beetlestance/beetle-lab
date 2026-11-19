import { liveMetricSubsetText, validateApi } from '../api/index.js';
import type { LiveMetricArchivePrefix, LiveMetricHash } from '../api/index.js';
import { liveMetricArchivePrefixMatches } from '../api/live-metrics.js';
import { encodeCanonicalJson } from '../json.js';
import type { K6LiveApproval } from './types.js';

export const K6_HISTORY_CHECKPOINT_NAMES = ['history-prefix-0.checkpoint', 'history-prefix-1.checkpoint'] as const;
export const K6_HISTORY_CHECKPOINT_SLOT_BYTES = 4096;
const checksumBytes = 66;
const payloadBytes = K6_HISTORY_CHECKPOINT_SLOT_BYTES - checksumBytes;

function capture(input: unknown, approval: K6LiveApproval): LiveMetricArchivePrefix {
  const prefix = validateApi('LiveMetricArchivePrefix', input);
  if (
    !prefix.ok ||
    !liveMetricArchivePrefixMatches(prefix.value, approval.scope) ||
    (prefix.value.target && prefix.value.target.intervalMs !== approval.targetIntervalMs)
  )
    throw new Error('Invalid k6 history checkpoint');
  return prefix.value;
}

function body(prefix: LiveMetricArchivePrefix, approval: K6LiveApproval, hash: LiveMetricHash): string {
  return encodeCanonicalJson(
    {
      version: 1,
      producerEpoch: approval.producerEpoch,
      subsetDigest: hash(liveMetricSubsetText(approval.subset)),
      prefix,
    },
    payloadBytes,
  );
}

export function encodeK6HistoryCheckpoint(
  prefix: LiveMetricArchivePrefix,
  approval: K6LiveApproval,
  hash: LiveMetricHash,
): Uint8Array {
  const text = body(capture(prefix, approval), approval, hash);
  const digest = hash(text);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid k6 history checkpoint digest');
  return new TextEncoder().encode(`${text}\n${digest}\n`);
}

/** Decode one bounded slot against independently derived launch approval. */
export function decodeK6HistoryCheckpoint(
  bytes: Uint8Array,
  approval: K6LiveApproval,
  hash: LiveMetricHash,
): LiveMetricArchivePrefix | undefined {
  if (bytes.byteLength <= checksumBytes || bytes.byteLength > K6_HISTORY_CHECKPOINT_SLOT_BYTES) return undefined;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const lines = decoded.split('\n');
    if (lines.length !== 3 || lines[2] !== '') return undefined;
    const text = lines[0]!;
    const digest = lines[1]!;
    if (!/^[a-f0-9]{64}$/.test(digest) || hash(text) !== digest) return undefined;
    const payload = JSON.parse(text) as { prefix?: unknown };
    const prefix = capture(payload.prefix, approval);
    return body(prefix, approval, hash) === text ? prefix : undefined;
  } catch {
    return undefined;
  }
}
