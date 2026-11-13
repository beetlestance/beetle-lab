import { expect, it } from 'vitest';
import type { AdmissionSnapshot, DiskRetention } from '../../src/admission/index.js';
import { decideAdmission, MAX_RESOURCE_VALUE } from '../../src/admission/index.js';
import { candidate, configuration, now, observation, reservation } from './fixtures.js';

function snapshot(): AdmissionSnapshot {
  return { now, lastClock: now, configuration: configuration(), observation: observation(), reservations: [], queue: [] };
}
const empty = { replayBytes:0, heldCount: 0, outputBytes: 0, stagingBytes: 0 };
it('requires actual closed retention facts and rejects hidden/accessor/unsafe carriers', () => {
  for (const retained of [undefined, {}, { ...empty, extra: 1 }, { ...empty, outputBytes: 1 },
    { ...empty, heldCount: 4097 }, { ...empty, heldCount: 1, stagingBytes: Number.MAX_SAFE_INTEGER + 1 },
    Object.defineProperty({ ...empty }, 'outputBytes', { get() { throw new Error('invoked'); } }),
    Object.defineProperty({ ...empty }, 'secret', { value: 1 })]) {
    expect(() => decideAdmission(candidate(), snapshot(), retained as DiskRetention)).toThrow('invalid_input');
  }
});
it('defers representable debt without overflow, including candidate additions near the safe bound', () => {
  const item = candidate();
  for (const outputBytes of [4001, Number.MAX_SAFE_INTEGER]) {
    expect(decideAdmission(item, snapshot(), { replayBytes:0, heldCount: 1, outputBytes, stagingBytes: 0 }))
      .toEqual({ kind: 'defer', reason: 'budget_unavailable' });
  }
  const s = snapshot(); s.configuration.pool.outputBytes = MAX_RESOURCE_VALUE;
  s.observation!.capacity.outputBytes = MAX_RESOURCE_VALUE;
  expect(decideAdmission(item, s, { replayBytes:0, heldCount: 4096, outputBytes: 0, stagingBytes: 0 }))
    .toEqual({ kind: 'defer', reason: 'retention_capacity' });
});
it('frees retained CPU, concurrency and isolation while preserving both disk promises', () => {
  const item = candidate(); item.mode = 'isolated';
  const s = snapshot(); s.configuration.maxConcurrent = 1;
  const old = reservation({ ...item, mode: 'isolated' }, false); s.reservations = [old];
  const held = { replayBytes:0, heldCount: 1, outputBytes: old.resources.outputBytes, stagingBytes: old.resources.stagingBytes };
  expect(decideAdmission(item, s, held)).toEqual({ kind: 'admit' });
  s.configuration.pool.stagingBytes = item.resources.stagingBytes;
  expect(decideAdmission(item, s, held)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
});
it('does not charge retained physical files against the native future-write check twice', () => {
  const item = candidate(); const s = snapshot();
  s.observation!.freeDiskBytes = item.resources.outputBytes + item.resources.stagingBytes;
  expect(decideAdmission(item, s, { replayBytes:0, heldCount: 1, outputBytes: 100, stagingBytes: 500_000 })).toEqual({ kind: 'admit' });
  s.observation!.freeDiskBytes--;
  expect(decideAdmission(item, s, { replayBytes:0, heldCount: 1, outputBytes: 100, stagingBytes: 500_000 }))
    .toEqual({ kind: 'defer', reason: 'disk_unavailable' });
});
it('uses retained disk in predecessor fit and preserves promotion and intrinsic rejection', () => {
  const item = candidate(); item.order = 2; const older = { ...candidate(), order: 1 };
  older.resources = { ...older.resources, outputBytes: 3800 }; older.budget = { ...older.budget, outputBytes: 3800 };
  const s = snapshot(); s.queue = [older]; const held = { replayBytes:0, heldCount: 1, outputBytes: 300, stagingBytes: 0 };
  expect(decideAdmission(item, s, held)).toEqual({ kind: 'admit' });
  expect(decideAdmission(item, s, empty)).toEqual({ kind: 'defer', reason: 'fifo_predecessor' });
  older.queuedAt = now - 30_000;
  expect(decideAdmission(item, s, held)).toEqual({ kind: 'defer', reason: 'promoted_predecessor' });
  item.resources.outputBytes = 4001;
  expect(decideAdmission(item, s, held)).toEqual({ kind: 'reject', reason: 'per_run_ceiling' });
});

it('counts permanent replay storage when no holds remain without consuming retention slots',()=>{
 const item=candidate();const s=snapshot();
 const available=s.configuration.pool.stagingBytes-item.resources.stagingBytes;
 expect(decideAdmission(item,s,{heldCount:0,outputBytes:0,stagingBytes:0,replayBytes:available})).toEqual({kind:'admit'});
 expect(decideAdmission(item,s,{heldCount:0,outputBytes:0,stagingBytes:0,replayBytes:available+1})).toEqual({kind:'defer',reason:'budget_unavailable'});
 expect(decideAdmission(item,s,{heldCount:0,outputBytes:0,stagingBytes:0,replayBytes:Number.MAX_SAFE_INTEGER})).toEqual({kind:'defer',reason:'budget_unavailable'});
});
