import { expect, it } from 'vitest';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { fixture, artifact } from './output-custody-fixtures.js';
import { hash, json } from './output-payload-fixtures.js';
import { acknowledge, reserveAndMark } from './execution-foundation-fixtures.js';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { OutputCustody } from '../../src/adapters/outbound/sqlite/output-custody/index.js';
import { outputScanSql } from '../../src/adapters/outbound/sqlite/output-custody/scan.js';
import { finalizationFixture } from '../output-finalization/fixture.js';
import { absenceFixture } from '../output-absence/fixture.js';
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
  const plan = (sql: string) => f.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    .map(row => String(row.detail));
  for (const detail of [plan(outputScanSql.last), plan(outputScanSql.page)]) {
    expect(detail.some(row => /USING (COVERING )?INDEX execution_event_pending\b/.test(row))).toBe(true);
    expect(detail.some(row => /^SCAN execution_records$/.test(row) || row.includes('TEMP B-TREE'))).toBe(false);
  }
});
it.each(['finalisation', 'absence closure'] as const)('removes the attempt from output discovery after %s', mode => {
  const scan = (db: DatabaseSync) => new OutputCustody(db, 'synthetic-installation').execute({kind: 'outputScan', query: {limit: 32}});
  const f = mode === 'finalisation' ? finalizationFixture() : absenceFixture(); f.ready();
  expect(scan(f.db)).toMatchObject({items: [{kind: 'ready', binding: f.binding}], nextCursor: null});
  expect(f.finalize()).toMatchObject({kind: 'finalized'});
  expect(f.db.prepare('SELECT event_pending FROM execution_records').get()).toEqual({event_pending: 0});
  expect(scan(f.db)).toEqual({items: [], nextCursor: null});
});
