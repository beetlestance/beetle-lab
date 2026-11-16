import { expect, it } from 'vitest';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { fixture, artifact } from './output-custody-fixtures.js';
import { hash, json } from './output-payload-fixtures.js';
import { acknowledge, reserveAndMark } from './execution-foundation-fixtures.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
it.each(['engine', 'installed', 'intent', 'physical', 'scope'] as const)('refuses validly sealed manifest with wrong original %s', mode => {
  const f = fixture(); const {manifestDigest, ...core} = f.envelope.manifest; void manifestDigest;
  const binding = {...core.binding};
  if (mode === 'engine') binding.engine = {...binding.engine, configVersion: 999};
  if (mode === 'installed') binding.installedIdentity = {...binding.installedIdentity, schemaDigest: 'e'.repeat(64)};
  if (mode === 'intent') binding.intentDigest = 'e'.repeat(64);
  if (mode === 'physical') binding.journalAuthority = '11111111-1111-4111-8111-111111111111';
  if (mode === 'scope') binding.workspaceId = '11111111-1111-4111-8111-111111111111';
  expect(() => {
    const manifest = prepareOutputManifest({...core, binding}, hash);
    const envelope = {...f.envelope, manifest, closure: {...f.envelope.closure,
      receipt: {...f.envelope.closure.receipt, manifestDigest: manifest.manifestDigest,
        journalAuthority: binding.journalAuthority}}};
    f.outputs.execute({kind: 'outputAdopt', request: {binding: f.binding, envelope}});
  }).toThrow();
  expect(f.carrier()).toHaveLength(0);
});
it.each([0, -1])('enforces exact shared manifest/artifact/event quota at delta %i', delta => {
  const sample = fixture(10000, [artifact]);
  const size = Buffer.byteLength(json(sample.envelope.manifest)) + artifact.bytes + sample.event().chargedBytes;
  const f = fixture(size + delta, [artifact]); f.create(); f.append();
  if (delta === 0) expect(f.adopt()).toMatchObject({kind: 'adopted', artifacts: [{bytes: 32}]});
  else { expect(f.adopt).toThrow(); expect(f.carrier()).toHaveLength(0); }
});
it('uses indexed finite upper discovery independent of physical release and cursor installation/lane', () => {
  const f = fixture(10000,[],500000);
  const next = f.add(71, 'parallel', 100, 10000); transaction(f.db, () => {reserveAndMark(f.db, next); acknowledge(f.db, next);});
  f.release(f.key);
  const page = f.outputs.execute({kind: 'outputScan', query: {limit: 1}});
  expect(page).toMatchObject({items: [{kind: 'ready', binding: f.binding}]});
  if (!page || !('nextCursor' in page) || !page.nextCursor) throw new Error('Missing finite cursor');
  const late = f.add(72, 'parallel', 100, 10000); transaction(f.db, () => {reserveAndMark(f.db, late); acknowledge(f.db, late);});
  expect(f.outputs.execute({kind: 'outputScan', query: {limit: 1, cursor: page.nextCursor}}))
    .toMatchObject({items: [{kind: 'ready', binding: {key: next}}], nextCursor: null});
  const cursor = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString()) as {lane: string}; cursor.lane = 'events';
  expect(() => f.outputs.execute({kind: 'outputScan', query: {limit: 1, cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url')}})).toThrow();
  expect(f.db.prepare(`EXPLAIN QUERY PLAN SELECT attempt_id FROM execution_records INDEXED BY execution_output_pending
    WHERE acknowledged_generation=1 AND output_pending=1 AND (queue_order,attempt_id)>(0,'') ORDER BY queue_order,attempt_id LIMIT 33`).all()
    .some(row => String(row.detail).includes('execution_output_pending'))).toBe(true);
});
