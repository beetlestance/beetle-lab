import type { Operation } from './lifetime.js';

export async function hash(owner: Operation, body: Uint8Array): Promise<string> {
  owner.check();
  const value = await globalThis.crypto.subtle.digest('SHA-256', body);
  owner.check();
  const bytes = new Uint8Array(value);
  if (bytes.length !== 32) throw new Error('digest');
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function digest(owner: Operation, body: Uint8Array, expected: string): Promise<void> {
  if (await hash(owner, body) !== expected) throw new Error('integrity');
}
