import { encodeJson } from '@beetle/contracts';
import type { RuntimeObservation } from '../admission/index.js';
import { validWall } from './publisher-input.js';
import type { PublishedObservation } from './publisher-types.js';

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
/** Owns only the publisher's private copied observation, never the observer input. */
export function publication(observation: RuntimeObservation, sampleStartedAtMs: number, ttlMs: number): PublishedObservation {
  const expiresAtMs = sampleStartedAtMs + ttlMs;
  if (!validWall(sampleStartedAtMs) || !validWall(expiresAtMs)) throw new Error('invalid_publication');
  const frame = { sampleStartedAtMs, expiresAtMs, observation };
  encodeJson(frame, 16_384);
  freeze(frame);
  return frame;
}
