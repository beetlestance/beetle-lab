export function invalid(): never { throw new Error('Invalid metric value'); }
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length || required.some(k => !keys.includes(k))) return invalid();
  for (const key of keys) {
    admittedKey(key, [...required, ...optional]);
    ownData(value, key);
  }
  return value as Record<string, unknown>;
}
export function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) return invalid();
  return value;
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const n = numeric(value); if (!Number.isSafeInteger(n) || n > max) return invalid(); return n;
}
export function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || value.length > 128 || !pattern.test(value)) return invalid(); return value;
}
export function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
  }
  return value as unknown[];
}
function ownData(value: object, key: PropertyKey): void {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
}
function admittedKey(key: PropertyKey, allowed: readonly string[]): void {
  if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
}
