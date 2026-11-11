import { record } from './inspect.js';
import type { DockerReply } from './types.js';
import type { ResourceReading } from './resource-types.js';

export function unknownResources(reason: ResourceReading['reason']): ResourceReading {
  return { cpuMillis: null, memoryBytes: null, pids: null, reason };
}
function scalar(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'invalid';
}
function counter(body: Record<string, unknown>, path: string[]): number | null | 'invalid' {
  let value: unknown = body;
  for (const key of path) {
    if (value === undefined || value === null) return null;
    const parent = record(value);
    if (!parent) return 'invalid';
    value = parent[key];
  }
  return scalar(value);
}
export interface ResourceCounter { cpuNs: number | null }
function observeCpu(cpu: number | null, previous: ResourceCounter) {
  const reset = cpu !== null && previous.cpuNs !== null && cpu < previous.cpuNs;
  if (cpu !== null) previous.cpuNs = cpu;
  return { reset, millis: cpu === null || reset ? null : Math.floor(cpu / 1_000_000) };
}
function measurements(body: Record<string, unknown>, previous: ResourceCounter): ResourceReading {
  const cpu = counter(body, ['cpu_stats', 'cpu_usage', 'total_usage']);
  const memory = counter(body, ['memory_stats', 'usage']);
  const pids = counter(body, ['pids_stats', 'current']);
  if (cpu === 'invalid' || memory === 'invalid' || pids === 'invalid') return unknownResources('invalid');
  const observedCpu = observeCpu(cpu, previous);
  return { cpuMillis: observedCpu.millis, memoryBytes: memory, pids,
    reason: observedCpu.reset ? 'counter_reset' : [cpu, memory, pids].includes(null) ? 'unsupported' : null };
}
/** Docker API values are raw usage; no CLI cache subtraction or CPU rate estimation. */
export function resourceReading(reply: DockerReply, id: string, previous: ResourceCounter): ResourceReading {
  if (!reply.ok) return unknownResources(reply.reason === 'malformed' ? 'invalid' : 'unavailable');
  if ([400, 501].includes(reply.status)) return unknownResources('unsupported');
  if (reply.status !== 200) return unknownResources('unavailable');
  const body = record(reply.body);
  if (!body || body.id !== id) return unknownResources('invalid');
  return measurements(body, previous);
}
