import { encodeJson } from '@beetle/contracts';
import { compatibleVersion, record, supportedDaemon } from './inspect.js';
import { failure } from './types.js';
import type { Result } from './types.js';

export interface DaemonResources { readonly daemonId: string; readonly cpuMillis: number; readonly memoryBytes: number }
const maximum = Math.floor(Number.MAX_SAFE_INTEGER / 256);

function body(raw: unknown): Record<string, unknown> | undefined {
  const reply = record(JSON.parse(encodeJson(raw, 1_048_576)));
  return reply?.ok === true && reply.status === 200 ? record(reply.body) : undefined;
}
function positive(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= limit;
}
function validDaemonId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:._-]{1,128}$/u.test(value);
}

/** Read-only baseline support and daemon/VM totals; never idle resources or physical PID capacity. */
export function daemonResources(versionReply: unknown, infoReply: unknown, expectedDaemonId: string): Result<DaemonResources> {
  try {
    if (!validDaemonId(expectedDaemonId)) return failure('invalid_input');
    const version = body(versionReply); const info = body(infoReply);
    if (!version || !info) return failure('malformed');
    if (!compatibleVersion(version) || !supportedDaemon(info)) return failure('unsupported');
    if (info.ID !== expectedDaemonId) return failure('conflict');
    if (!positive(info.NCPU, Math.floor(maximum / 1000)) || !positive(info.MemTotal, maximum)) return failure('malformed');
    return { ok: true, value: Object.freeze({ daemonId: expectedDaemonId, cpuMillis: info.NCPU * 1000, memoryBytes: info.MemTotal }) };
  } catch { return failure('malformed'); }
}
