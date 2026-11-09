import { prepareK6SecretReferences } from '@beetle/contracts/engine-config/k6';
import type { K6SecretBindings } from '@beetle/contracts/engine-config/k6';
import type { Offer } from '@beetle/contracts';
import type { ValidatedSuiteConfig } from '../../compiler/suite/index.js';
export type SecretBindings = K6SecretBindings;

/** Shared translation keeps application offers and staged engine checks identical. */
export function prepareSecretReferences(config: ValidatedSuiteConfig): SecretBindings {
  return prepareK6SecretReferences(config.secrets);
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
