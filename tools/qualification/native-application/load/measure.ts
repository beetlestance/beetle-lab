import assert from 'node:assert/strict';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
export interface Sample {readonly at: number; readonly cpuNanos: number; readonly memoryBytes: number; readonly anonymousBytes: number | null}
function object(input: unknown): Record<string, unknown> {assert(input && typeof input === 'object' && !Array.isArray(input)); return input as Record<string, unknown>;}
function integer(input: unknown): number {assert(typeof input === 'number' && Number.isSafeInteger(input) && input >= 0); return input;}
export function capture(input: unknown, id: string, at: number): Sample {
  assert(/^[a-f0-9]{64}$/.test(id) && Number.isFinite(at)); const row = object(input);
  if (Object.hasOwn(row, 'id')) assert.equal(row.id, id);
  const cpu = object(object(row.cpu_stats).cpu_usage); const memory = object(row.memory_stats);
  const stats = object(memory.stats);
  return {at, cpuNanos: integer(cpu.total_usage), memoryBytes: integer(memory.usage),
    anonymousBytes: stats.anon === undefined ? null : integer(stats.anon)};
}
export async function sample(transport: DockerTransport, id: string): Promise<Sample> {
  assert(/^[a-f0-9]{64}$/.test(id)); const signal = AbortSignal.timeout(2000); const deadline = performance.now() + 2000;
  const response = await transport.request({method: 'GET', path: `/v1.47/containers/${id}/stats?stream=false&one-shot=true`, signal, deadline});
  assert(response.ok && response.status === 200 && !signal.aborted && performance.now() < deadline);
  return capture(response.body, id, performance.now());
}
export function summarize(samples: readonly Sample[], ceiling: number) {
  assert(samples.length >= 2 && samples.length <= 128); const first = samples[0]!; const last = samples.at(-1)!;
  assert(last.at > first.at && last.cpuNanos >= first.cpuNanos);
  const peakMemoryBytes = Math.max(...samples.map(item => item.memoryBytes)); assert(peakMemoryBytes <= ceiling);
  for (let index = 1; index < samples.length; index++) {
    assert(samples[index]!.at > samples[index - 1]!.at && samples[index]!.cpuNanos >= samples[index - 1]!.cpuNanos);
  }
  return {samples: samples.length, elapsedMs: last.at - first.at, first, last,
    cpuOneCorePercent: (last.cpuNanos - first.cpuNanos) / ((last.at - first.at) * 10000), peakMemoryBytes,
    anonymousBytes: samples.every(item => item.anonymousBytes !== null) ? Math.max(...samples.map(item => item.anonymousBytes!)) : null};
}
export function percentile(values: readonly number[], fraction: number): number {
  assert(values.length > 0 && values.length <= 512 && fraction > 0 && fraction <= 1);
  assert(values.every(value => Number.isFinite(value) && value >= 0));
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!;
}
