import { expect } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { EventBatch } from '@beetle/contracts';
import type { EventBinding } from '../../../src/ports/events.js';
import { eventIdentity, request } from './fixtures.js';
import source from '../../../../contracts/fixtures/valid/events.json' with { type: 'json' };
export function large(binding: EventBinding, count = 4): EventBatch {
  const value = request(binding, 0, count).batch;
  const template = structuredClone((source as EventBatch).events.find(event => event.kind === 'engine.result')!);
  const identity = eventIdentity(binding);
  template.payload = { ...template.payload, ...identity };
  template.payload.artifacts = Array.from({ length: 100 }, (_, index) => ({ ...template.payload.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, relativePath: String(index) }));
  value.events = Array.from({ length: count }, (_, index) => ({ ...structuredClone(template), ...identity, seq: index + 1 }));
  return value;
}
export function grow(batch: EventBatch, target: number, record = false): void {
  let remaining = target - Buffer.byteLength(JSON.stringify(record ? batch.events[0] : batch));
  for (const event of batch.events) {
    if (event.kind !== 'engine.result') throw new Error('fixture kind');
    const maximum = record ? target : 66048;
    let room = maximum - Buffer.byteLength(encodeCanonicalJson(event, 262145));
    for (const artifact of event.payload.artifacts) {
      const extra = Math.max(0, Math.min(remaining, room, 512 - artifact.relativePath.length));
      artifact.relativePath += 'a'.repeat(extra); remaining -= extra; room -= extra;
    }
  }
  expect(remaining).toBe(0);
}
