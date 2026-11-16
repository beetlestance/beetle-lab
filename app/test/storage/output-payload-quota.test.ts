import { expect, it } from 'vitest';
import type { Artifact } from '@beetle/contracts';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { request } from './events/fixtures.js';
import { payloadFixture, json } from './output-payload-fixtures.js';
const artifact: Artifact = { artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'raw', relativePath: 'data.bin', bytes: 32, sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' };

it.each(['result-first', 'event-first'] as const)('reserves exact event+result bytes in either serialized order: %s', order => {
  const sample = payloadFixture(); const size = Buffer.byteLength(json(sample.value)); const charge = sample.event().chargedBytes;
  const f = payloadFixture(size + charge); f.create();
  if (order === 'result-first') { f.observe({ lastSeq: 2, result: f.value }); f.append(); }
  else { f.append(); f.observe({ lastSeq: 2, result: f.value }); }
  expect(f.cursor().retained_bytes).toBe(charge); expect(f.carrier()).toHaveLength(1);
  expect(f.db.prepare('SELECT body_bytes+artifact_bytes AS n FROM execution_output_charges').get()?.n).toBe(size);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['result-first', 'event-first'] as const)('one byte short rejects the losing native event/body transaction: %s', order => {
  const sample = payloadFixture(); const size = Buffer.byteLength(json(sample.value)); const charge = sample.event().chargedBytes;
  const f = payloadFixture(size + charge - 1); f.create();
  if (order === 'result-first') {
    f.observe({ lastSeq: 2, result: f.value }); const before = f.facts(); expect(() => f.append()).toThrow(); expect(f.facts()).toEqual(before);
  } else {
    f.append(); const before = f.facts(); expect(() => f.observe({ lastSeq: 2, result: f.value })).toThrow(); expect(f.facts()).toEqual(before);
  }
});
it.each([0, -1])('charges one manifest plus all declared artifacts in shared event preflight at boundary %i', delta => {
  const sample = payloadFixture(); const bytes = Buffer.byteLength(json(sample.manifest([artifact]))) + artifact.bytes;
  const charge = sample.event().chargedBytes; const f = payloadFixture(bytes + charge + delta); f.putManifest([artifact]);
  const events = new EventCustody(f.db, 'synthetic-installation'); const value = events.ingest(request(f.binding));
  expect(value.inserted).toBe(delta === 0 ? 1 : 0);
  expect(value.state.retainedBytes).toBe(delta === 0 ? charge : 0);
  expect(value.state.blockedReason).toBe(delta === 0 ? null : 'quota_exhausted');
});
it('replaces S by M in one row at exact final fit without requiring S+M temporary headroom', () => {
  const sample = payloadFixture(); const bytes = Buffer.byteLength(json(sample.manifest())); const f = payloadFixture(bytes);
  f.observe({ lastSeq: 2, result: f.value }); expect(() => f.putManifest()).not.toThrow();
  expect(f.carrier()).toHaveLength(1); expect(f.db.prepare('SELECT body_bytes FROM execution_output_charges').get()?.body_bytes).toBe(bytes);
});
