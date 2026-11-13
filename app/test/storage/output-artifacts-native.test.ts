import { expect, it } from 'vitest';
import { fixture, artifact } from './output-custody-fixtures.js';
import { artifactsFixture, stageIdentity, writerId } from './output-artifacts-fixtures.js';
function nativeFixture() {
  const f = artifactsFixture();
  const raw = () => JSON.parse(String(f.slots()[0]!.slot_json)) as Record<string, unknown>;
  const update = (next: Record<string, unknown>) => f.db.prepare('UPDATE execution_output_slots SET slot_json=?').run(JSON.stringify(next));
  const refused = (next: Record<string, unknown>) => { const before = f.allFacts(); expect(() => update(next)).toThrow(); expect(f.allFacts()).toEqual(before); };
  return {...f, raw, update, refused};
}
it('native migration010 rejects malformed trees, arithmetic and every illegal transition without changing facts', () => {
  const f = nativeFixture(); const initial = f.raw();
  for (const patch of [{v: 2}, {t: writerId, v: 2}, {o: 1, v: 2}, {p: 'publishing', v: 2},
    {i: stageIdentity, v: 2}, {v: 2, extra: true}, {v: 2, w: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'},
    {v: 2, w: 1}, {v: 2, w: writerId, i: 0}, {v: 2, w: writerId, t: 'bad'},
    {v: 2.5, w: writerId}, {v: Number.MAX_SAFE_INTEGER + 1, w: writerId}, {v: '2', w: writerId}]) f.refused({...initial, ...patch});
  const before = f.allFacts();
  for (const text of ['{', '[]', JSON.stringify({...initial, w: writerId, v: 2}).replace('"v":2', '"v":2,"v":2'),
    JSON.stringify({...initial, w: writerId, v: 2, padding: 'x'.repeat(257)})]) {
    expect(() => f.db.prepare('UPDATE execution_output_slots SET slot_json=?').run(text)).toThrow();
  }
  expect(() => f.db.prepare('UPDATE execution_output_slots SET ordinal=1').run()).toThrow();
  expect(() => f.db.prepare('UPDATE execution_output_slots SET attempt_id=?').run(writerId)).toThrow();
  expect(() => f.db.prepare('DELETE FROM execution_output_slots').run()).toThrow();
  expect(() => f.db.prepare('INSERT OR REPLACE INTO execution_output_slots VALUES(?,?,?)')
    .run(f.key.binding.key.attempt.attemptId, 0, JSON.stringify(initial))).toThrow();
  expect(f.allFacts()).toEqual(before);
  const claimed = f.claim(); const slot = f.raw();
  for (const patch of [{v: 3}, {v: 3, w: null}, {v: 3, w: claimed.artifact.token}, {v: 3, o: 1},
    {v: 3, o: 33, i: stageIdentity}, {v: 3, o: Number.MAX_SAFE_INTEGER + 1, i: stageIdentity},
    {v: 3, o: '0', i: stageIdentity}, {v: 3, o: 0.5, i: stageIdentity}, {v: 3, p: 'publishing', i: stageIdentity}]) f.refused({...slot, ...patch});
  const half = f.progress(claimed, 10); const halfSlot = f.raw();
  for (const patch of [{o: 9}, {i: null}, {i: 'f'.repeat(64)}, {p: 'published', o: 32, w: null}]) f.refused({...halfSlot, v: 4, ...patch});
  const full = f.progress(half, 32); const publishing = f.begin(full); const pubSlot = f.raw();
  for (const patch of [{p: 'transferring'}, {w: null}, {p: 'published', o: 31, w: null}, {p: 'published'}, {i: 'f'.repeat(64)}]) f.refused({...pubSlot, v: 6, ...patch});
  f.publish(publishing); f.refused({...f.raw(), v: 7});
  expect(() => f.db.prepare('UPDATE execution_output_sources SET version=2').run()).toThrow();
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('native guards permit exactly the four transitions and return mutable slots', () => {
  const f = nativeFixture(); let slot = f.raw();
  f.update({...slot, v: 2, w: writerId}); slot = f.raw();
  f.update({...slot, v: 3, o: 32, i: stageIdentity}); slot = f.raw();
  f.update({...slot, v: 4, p: 'publishing'}); slot = f.raw();
  f.update({...slot, v: 5, p: 'published', i: 'f'.repeat(64), w: null});
  expect(f.outputs.execute({kind: 'outputLoad', binding: f.binding})).toMatchObject({version: 1, artifacts: [{version: 5, phase: 'published'}]});
  expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
});
it('retains native initial slot, token uniqueness and source immutability guards after migration010', () => {
  const f = fixture(10000, [artifact, {...artifact, artifactId: writerId}]); f.adopt();
  const rows = f.db.prepare('SELECT ordinal,slot_json FROM execution_output_slots ORDER BY ordinal').all();
  const first = JSON.parse(String(rows[0]!.slot_json)) as Record<string, unknown>;
  const second = JSON.parse(String(rows[1]!.slot_json)) as Record<string, unknown>;
  const before = f.facts();
  expect(() => f.db.prepare('UPDATE execution_output_slots SET slot_json=? WHERE ordinal=1')
    .run(JSON.stringify({...second, v: 2, t: first.t, w: writerId}))).toThrow();
  expect(() => f.db.prepare('INSERT OR REPLACE INTO execution_output_slots VALUES(?,?,?)')
    .run(f.key.attempt.attemptId, 1, JSON.stringify({...second, t: first.t}))).toThrow();
  expect(() => f.db.prepare('INSERT INTO execution_output_slots VALUES(?,?,?)')
    .run(f.key.attempt.attemptId, 2, JSON.stringify({...second, v: 2}))).toThrow();
  expect(() => f.db.prepare('DELETE FROM execution_output_sources').run()).toThrow();
  expect(() => f.db.prepare('UPDATE execution_output_sources SET source_digest=?').run('f'.repeat(64))).toThrow();
  expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT ordinal,slot_json FROM execution_output_slots ORDER BY ordinal').all()).toEqual(rows);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
