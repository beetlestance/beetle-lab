import type {DockerReply} from '../../../../agent/src/backends/docker/index.js';
const reasons = new Set(['invalid_input', 'unsupported', 'conflict', 'unavailable', 'deadline', 'aborted', 'request_limit',
  'response_limit', 'malformed', 'overflow', 'start_fenced', 'unsafe_state', 'cleanup_guard', 'rejected']);
export const diagnosticProgram = 'setTimeout(()=>{},15000)';
function counter(input: unknown, keys: readonly string[]): number | null {
  let value = input;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function status(reply: DockerReply): number | null {
  if (!reply.ok) return null;
  return Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599 ? reply.status : null;
}
/** Fixed scalar diagnosis; raw Docker replies and arbitrary error strings stay private. */
export function diagnosticFacts(reply: DockerReply, id: string) {
  const raw = reply.ok && reply.body && typeof reply.body === 'object' ? reply.body as Record<string, unknown> : {};
  const source = raw.id === id ? raw : {};
  const transportReason = reply.ok ? null : reasons.has(reply.reason) ? reply.reason : 'unavailable';
  return {ok: reply.ok, status: status(reply), transportReason, idPresent: typeof raw.id === 'string', idMatches: raw.id === id,
    rawCpuNanoseconds: counter(source, ['cpu_stats', 'cpu_usage', 'total_usage']),
    rawMemoryBytes: counter(source, ['memory_stats', 'usage']),
    rawPids: counter(source, ['pids_stats', 'current'])};
}
