import { createHash } from 'node:crypto';
import type { TaskPacket } from './types.js';
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function packetDigest(packet: TaskPacket): string {
  const payload = Object.fromEntries(Object.entries(packet).filter(([key]) => key !== 'packetHash'));
  return digest(canonical(payload));
}
