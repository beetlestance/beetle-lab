import { createHash } from 'node:crypto';
import { LIVE_HISTORY_BYTES, decodeLiveMetricHistory, encodeLiveMetricHistory } from '@beetle/contracts/api';
import type { ExecutionResult } from '@beetle/contracts';
import type { Owned } from '@beetle/contracts/output-source';
import type { Scope } from '../admission/index.js';
export const STOPPED_HISTORY_ROW_ALLOWANCE = 256;
export interface StoppedObservation {
  readonly json: string;
  readonly digest: string;
  readonly bytes: number;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function captureStoppedObservation(key: Scope, json: unknown): StoppedObservation {
  if (typeof json !== 'string' || json.length > LIVE_HISTORY_BYTES) throw new Error('Invalid stopped history');
  const bytes = Buffer.from(json);
  if (!bytes.length || bytes.length > LIVE_HISTORY_BYTES) throw new Error('Invalid stopped history');
  const value = decodeLiveMetricHistory(bytes, hash);
  const canonical = encodeLiveMetricHistory(value, hash, key);
  if (!bytes.equals(canonical)) throw new Error('Invalid stopped history');
  return { json, digest: hash(json), bytes: bytes.length };
}

export function eligibleStoppedSource(result: Owned<ExecutionResult>): boolean {
  return (
    !('purpose' in result) &&
    result.engineId === 'k6' &&
    result.completeness !== 'complete' &&
    !result.artifacts.some((artifact) => artifact.kind === 'metric-windows' || artifact.kind === 'metric-index')
  );
}

export function stoppedObservationReply(key: Scope, input: unknown): StoppedObservation {
  const reply = input as Partial<StoppedObservation>;
  const result = captureStoppedObservation(key, reply.json);
  if (result.digest !== reply.digest || result.bytes !== reply.bytes)
    throw new Error('Unexpected stopped history reply');
  return result;
}

export function boundedStoppedInput(input: unknown): input is string {
  return (
    typeof input === 'string' && input.length <= LIVE_HISTORY_BYTES && Buffer.byteLength(input) <= LIVE_HISTORY_BYTES
  );
}
