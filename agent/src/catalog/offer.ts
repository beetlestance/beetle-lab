import { join } from 'node:path';
import { RUNNER_MAXIMUM_OFFER_BYTES, encodeJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { prepareRuntime, runtimeName } from '../backends/docker/index.js';
import { CatalogError } from './types.js';
import type { EngineRegistration, InstalledEngine } from './types.js';

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function snapshot<T>(input: unknown, maximum: number): T {
  return JSON.parse(encodeJson(input, maximum)) as T;
}
export function offerSnapshot(input: unknown): Offer {
  try {
    const result = validate('Offer', snapshot<unknown>(input, RUNNER_MAXIMUM_OFFER_BYTES));
    if (result.ok) return result.value;
  } catch { /* Boundary errors never expose input or validator diagnostics. */ }
  throw new CatalogError('invalid_offer');
}
export function selector(engine: Offer['engine']): string {
  return JSON.stringify([engine.id, engine.imageDigest, engine.configVersion]);
}
export function permitsRuntime(offer: Offer, engine: EngineRegistration): boolean {
  const { profile, manifest } = engine;
  const name = runtimeName({ installationId: profile.installationId, ...offer, generation: 1 });
  const root = join(profile.stagingRoot, name);
  return prepareRuntime({ offer, manifest, profile, generation: 1,
    requireHardOutputQuota: offer.requiredCapabilities.includes('hard-output-quota'),
    staged: { input: join(root, 'input'), output: join(root, 'output'), secrets: join(root, 'secrets') } }).ok;
}
export function validateConfig(offer: Offer, engine: InstalledEngine): void {
  if (!engine.configSchema.validate(offer.config)) throw new CatalogError('invalid_config');
  if (!permitsRuntime(offer, engine)) throw new CatalogError('unapproved_engine');
}
