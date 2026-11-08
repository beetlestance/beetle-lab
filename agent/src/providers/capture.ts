import { ProviderError } from './types.js';

export function field(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object') throw new ProviderError('invalid_input');
  let descriptor: PropertyDescriptor | undefined;
  try { descriptor = Object.getOwnPropertyDescriptor(value, name); }
  catch { throw new ProviderError('invalid_input'); }
  if (descriptor && !('value' in descriptor)) throw new ProviderError('invalid_input');
  return descriptor?.value;
}
export function text(value: unknown, maximum = 128): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maximum) throw new ProviderError('invalid_input');
  return value;
}
export function uuid(value: unknown): string {
  const result = text(value, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result)) throw new ProviderError('invalid_input');
  return result;
}
export function token(value: unknown): string {
  const result = text(value);
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/.test(result)) throw new ProviderError('invalid_input');
  return result;
}
export function scope(value: unknown): readonly [string, string] {
  return [uuid(field(value, 'organizationId')), uuid(field(value, 'workspaceId'))];
}
export function secretKey(authority: unknown, secret: unknown): string {
  const provider = field(secret, 'provider');
  if (provider !== 'env' && provider !== 'mounted') throw new ProviderError('invalid_input');
  const version = field(secret, 'version');
  return JSON.stringify([...scope(authority), token(field(secret, 'name')), provider,
    token(field(secret, 'reference')), version === undefined ? null : text(version, 256)]);
}
export function signal(value: unknown): AbortSignal {
  if (!(value instanceof AbortSignal)) throw new ProviderError('invalid_input');
  return value;
}
export function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProviderError('closed');
}
