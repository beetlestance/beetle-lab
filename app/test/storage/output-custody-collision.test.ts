import type * as Crypto from 'node:crypto';
import { expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({collide: false}));
vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof Crypto>();
  return {...original, randomUUID: () => control.collide ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : original.randomUUID()};
});
import { fixture, artifact } from './output-custody-fixtures.js';
it('rolls back carrier, closure and every slot/counter on a native token collision', () => {
  const f = fixture(10000, [artifact, {...artifact, artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relativePath: 'other.bin'}]);
  const before = f.facts(); control.collide = true;
  try { expect(f.adopt).toThrow(); } finally { control.collide = false; } expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_sources').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_slots').get()?.n).toBe(0);
});
