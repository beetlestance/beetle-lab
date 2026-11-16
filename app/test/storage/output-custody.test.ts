import { describe, expect, it } from 'vitest';
import { json } from './output-payload-fixtures.js';
import { fixture } from './output-custody-fixtures.js';
describe('native output adoption', () => {
  it('stores one carrier and compact closure, preserving exact equal replay', () => {
    const f = fixture(); const first = f.adopt();
    expect(first).toMatchObject({kind: 'adopted'}); expect(f.adopt()).toEqual(first);
    expect(f.carrier()).toHaveLength(1);
    expect(f.db.prepare('SELECT result_observed FROM execution_records').get()?.result_observed).toBe(0);
    expect(f.outputs.execute({kind: 'outputReadSource', binding: f.binding})).toEqual(f.envelope);
    expect(f.outputs.execute({kind: 'outputScan', query: {limit: 1}})).toMatchObject({items: [{kind: 'ready'}]});
  });
  it('returns pending/null under retained original and refuses wrong physical scope', () => {
    const f = fixture(); expect(f.outputs.execute({kind: 'outputLoad', binding: f.binding})).toMatchObject({kind: 'pending'});
    expect(f.outputs.execute({kind: 'outputReadSource', binding: f.binding})).toBeNull();
    expect(() => f.outputs.execute({kind: 'outputReadSource', binding: {...f.binding,
      journalAuthority: '11111111-1111-4111-8111-111111111111'}})).toThrow();
  });
  it('refuses changed original pins without mutation', () => {
    const f = fixture(); const before = f.facts();
    const envelope = {...f.envelope, manifest: {...f.envelope.manifest, binding: {...f.envelope.manifest.binding, specDigest: 'd'.repeat(64)}}};
    expect(() => f.outputs.execute({kind: 'outputAdopt', request: {binding: f.binding, envelope}})).toThrow();
    expect(f.facts()).toEqual(before);
  });
  it('atomically refuses event history above closure and enforces native end after adoption', () => {
    const f = fixture(); f.create(); f.append(); f.adopt();
    const event = JSON.parse(f.event().canonical) as Record<string, unknown>;
    const text = json({...event, seq: 2}); const charge = Buffer.byteLength(text) + 128;
    expect(() => f.db.prepare('INSERT INTO run_events VALUES(?,1,2,?,?,?)').run(f.key.attempt.attemptId,
      text, charge, Number(f.cursor().retained_bytes) + charge)).toThrow();
    const g = fixture(); g.create(); g.append();
    expect(() => g.outputs.execute({kind: 'outputAdopt', request: {binding: g.binding,
      envelope: {...g.envelope, closure: {...g.envelope.closure, finalAgentSeq: 0}}}})).toThrow();
    expect(g.carrier()).toHaveLength(0);
  });
  it('shares exact event/carrier quota and preserves observed result in both arrival orders', () => {
    const f = fixture(); f.observe({lastSeq: 2, result: f.value}); f.adopt();
    expect(f.db.prepare('SELECT result_observed FROM execution_records').get()?.result_observed).toBe(1);
    const g = fixture(); g.adopt(); g.observe({lastSeq: 2, result: g.value});
    expect(g.db.prepare('SELECT result_observed FROM execution_records').get()?.result_observed).toBe(1);
    const bytes = Buffer.byteLength(json(g.envelope.manifest));
    const exact = fixture(bytes); expect(exact.adopt()).toMatchObject({kind: 'adopted'});
    const short = fixture(bytes - 1); expect(short.adopt).toThrow(); expect(short.carrier()).toHaveLength(0);
  });
});
