import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, artifact } from './output-custody-fixtures.js';
import { json } from './output-payload-fixtures.js';
function sourceOnly(closure = (text: string): string => text) {
  const f = fixture(10000, [artifact, {...artifact, artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relativePath: 'other.bin'}]);
  f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, json(f.envelope.manifest));
  const a = f.key.attempt;
  f.db.prepare('INSERT INTO execution_output_sources VALUES(?,?,?,?,?,?,1,1,?,?,1,?)').run(a.attemptId, f.key.runId,
    a.organizationId, a.workspaceId, a.intentDigest, f.binding.journalAuthority, f.envelope.sourceDigest,
    f.envelope.manifest.manifestDigest, closure(json(f.envelope.closure)));
  return f;
}
it.each(['unsafe', 'duplicate keys', 'oversized', 'extra', 'invalid token', 'wrong offset'] as const)('natively refuses %s initial slots atomically', mode => {
  const f = sourceOnly();
  const slot = {v: 1, t: randomUUID(), o: 0, p: 'transferring', i: null, w: null};
  let text = json(slot);
  if (mode === 'unsafe') text = text.replace('"v":1', '"v":9007199254740992');
  if (mode === 'duplicate keys') text = text.replace('"v":1', '"v":1,"v":1');
  if (mode === 'oversized') text = text.replace(slot.t, 'a'.repeat(257));
  if (mode === 'extra') text = text.replace('"v":1', '"v":1,"extra":0');
  if (mode === 'invalid token') text = text.replace(slot.t, 'x'.repeat(36));
  if (mode === 'wrong offset') text = text.replace('"o":0', '"o":1');
  expect(() => f.db.prepare('INSERT INTO execution_output_slots VALUES(?,?,?)').run(f.key.attempt.attemptId, 0, text)).toThrow();
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_slots').get()?.n).toBe(0);
});
it('retains immutable closure/slots and rejects duplicate token namespace', () => {
  const second = {...artifact, artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relativePath: 'other.bin'};
  const f = fixture(10000, [artifact, second]); f.adopt();
  const row = f.db.prepare('SELECT slot_json FROM execution_output_slots LIMIT 1').get()!;
  expect(() => f.db.prepare('UPDATE execution_output_slots SET slot_json=?').run(row.slot_json!)).toThrow();
  expect(() => f.db.exec('DELETE FROM execution_output_sources')).toThrow();
  expect(() => f.db.exec('DELETE FROM execution_output_slots')).toThrow();
  expect(() => f.db.exec('UPDATE execution_output_sources SET final_agent_seq=2')).toThrow();
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('refuses changed installed identity and case ambiguous artifact identity before native writes', () => {
  const f = fixture(10000, [artifact, {...artifact, artifactId: artifact.artifactId.toUpperCase(), relativePath: 'other.bin'}]);
  expect(f.adopt).toThrow(); expect(f.carrier()).toHaveLength(0);
});

it('natively rejects a duplicate UUID across distinct valid artifact slots', () => {
  const f = sourceOnly(); const text = json({v: 1, t: randomUUID(), o: 0, p: 'transferring', i: null, w: null});
  const put = f.db.prepare('INSERT INTO execution_output_slots VALUES(?,?,?)');
  put.run(f.key.attempt.attemptId, 0, text);
  expect(() => put.run(f.key.attempt.attemptId, 1, text)).toThrow();
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_slots').get()?.n).toBe(1);
});

it.each(['duplicate', 'oversize', 'unsafe', 'typed', 'extra', 'wrong receipt'] as const)('natively rejects %s compact source closure before path authority', mode => {
  expect(() => sourceOnly(text => {
    if (mode === 'duplicate') return text.replace('"version":1', '"version":1,"version":1');
    if (mode === 'oversize') return text.replace('"version":1', '"padding":"' + 'x'.repeat(2049) + '","version":1');
    if (mode === 'unsafe') return text.replace('"finalAgentSeq":1', '"finalAgentSeq":9007199254740992');
    if (mode === 'typed') return text.replace('"finalAgentSeq":1', '"finalAgentSeq":"1"');
    if (mode === 'extra') return text.replace('"version":1', '"version":1,"other":0');
    return text.replace('"sourceDigest":"' + 'c'.repeat(64), '"sourceDigest":"' + 'd'.repeat(64));
  })).toThrow();
});
