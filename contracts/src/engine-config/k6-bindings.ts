import { encodeJson } from '../json.js';
import { validatePrimitive } from '../validate.js';
import type { SecretReference } from '../generated/types.js';

type Failure = { readonly ok: false; readonly code: 'unsupported_secret_reference' | 'conflicting_secret_reference' };
export type K6SecretBindings = { readonly ok: true; readonly value: readonly Readonly<SecretReference>[] } | Failure;

/** Declared opaque aliases only; no provider I/O, paths or resolved secret values. */
export function prepareK6SecretReferences(secrets: unknown): K6SecretBindings {
  try { return prepare(JSON.parse(encodeJson(secrets, 131072)) as unknown); }
  catch { return { ok: false, code: 'unsupported_secret_reference' }; }
}
function prepare(secrets: unknown): K6SecretBindings {
  if (!Array.isArray(secrets) || secrets.length > 64) return { ok: false, code: 'unsupported_secret_reference' };
  const references: Readonly<SecretReference>[] = []; const names = new Set<string>();
  for (const value of secrets) {
    if (value === null || typeof value !== 'object') return { ok: false, code: 'unsupported_secret_reference' };
    const secret = value as Record<string, unknown>;
    if (Object.keys(secret).some(key => !['name', 'provider', 'locator', 'version'].includes(key))) return { ok: false, code: 'unsupported_secret_reference' };
    const checked = validatePrimitive('secretReference', { name: secret.name, provider: secret.provider, reference: secret.locator,
      ...(secret.version === undefined ? {} : { version: secret.version }) });
    if (!checked.ok) return { ok: false, code: 'unsupported_secret_reference' };
    const name = checked.value.name.toLowerCase();
    if (names.has(name)) return { ok: false, code: 'conflicting_secret_reference' };
    names.add(name); references.push(Object.freeze(checked.value));
  }
  return Object.freeze({ ok: true, value: Object.freeze(references) });
}
