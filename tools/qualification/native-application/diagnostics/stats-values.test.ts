import {expect, it} from 'vitest';
import {Script} from 'node:vm';
import type {DockerReply} from '../../../../agent/src/backends/docker/index.js';
import {diagnosticFacts, diagnosticProgram} from './stats-values.js';
const id = 'a'.repeat(64); const canary = 'PRIVATE-CANARY';
it('emits only validated measurements and scalar native response facts', () => {
  const value = diagnosticFacts({ok: true, status: 200, body: {id, secret: canary, cpu_stats: {cpu_usage: {total_usage: 1000000}},
    memory_stats: {usage: 64000000}, pids_stats: {current: 7}}}, id);
  expect(value).toMatchObject({idMatches: true, rawCpuNanoseconds: 1000000, rawMemoryBytes: 64000000, rawPids: 7});
  expect(JSON.stringify(value)).not.toContain(canary);
});
it('distinguishes deadline and malformed responses without leaking arbitrary reason strings', () => {
  expect(diagnosticFacts({ok: false, reason: 'deadline', dispatched: true}, id)).toMatchObject({transportReason: 'deadline', rawCpuNanoseconds: null});
  const value = diagnosticFacts({ok: false, reason: canary, dispatched: true} as unknown as DockerReply, id);
  expect(JSON.stringify(value)).not.toContain(canary); expect(value.transportReason).toBe('unavailable');
  expect(diagnosticFacts({ok: true, status: 200, body: {id: 'wrong', secret: canary}}, id).rawCpuNanoseconds).toBe(null);
});
it('compiles the finite idle-container program without executing it', () => {expect(() => new Script(diagnosticProgram)).not.toThrow();});
