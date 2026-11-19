import { createHash } from 'node:crypto';
import { LIVE_HISTORY_BYTES, decodeLiveMetricHistory, encodeLiveMetricHistory } from '@beetle/contracts/api';
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
