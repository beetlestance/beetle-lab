import { validatePrimitive } from '@beetle/contracts';
import type { Offer, SecretReference } from '@beetle/contracts';
import type { ValidatedSuiteConfig } from '../../compiler/suite/index.js';

type Failure = { readonly ok: false; readonly code: 'unsupported_secret_reference' | 'conflicting_secret_reference' };
export type SecretBindings = { readonly ok: true; readonly value: readonly Readonly<SecretReference>[] } | Failure;

/** First-release providers use opaque aliases, never host paths or resolved values. */
export function prepareSecretReferences(config: ValidatedSuiteConfig): SecretBindings {
  const references: Readonly<SecretReference>[] = [];
  const names = new Set<string>();
  for (const secret of config.secrets) {
    const reference = { name: secret.name, provider: secret.provider, reference: secret.locator,
      ...(secret.version === undefined ? {} : { version: secret.version }) };
    const checked = validatePrimitive('secretReference', reference);
    if (!checked.ok) return { ok: false, code: 'unsupported_secret_reference' };
    // Portable staging must not alias two names on a case-insensitive host volume.
    const name = secret.name.toLowerCase();
    if (names.has(name)) return { ok: false, code: 'conflicting_secret_reference' };
    names.add(name); references.push(Object.freeze(checked.value));
  }
  return Object.freeze({ ok: true, value: Object.freeze(references) });
}

/** Compare declared identities only; provider/version resolution belongs to trusted staging. */
export function matchSecretReferences(config: ValidatedSuiteConfig, offer: Offer): boolean {
  const prepared = prepareSecretReferences(config);
  if (!prepared.ok) return false;
  const actual = offer.secretReferences ?? [];
  if (actual.length !== prepared.value.length) return false;
  const names = new Set<string>();
  return actual.every(reference => {
    if (names.has(reference.name)) return false;
    names.add(reference.name);
    return prepared.value.some(expected => expected.name === reference.name && expected.provider === reference.provider
      && expected.reference === reference.reference && expected.version === reference.version);
  });
}
