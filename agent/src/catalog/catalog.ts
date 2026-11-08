import type { Offer } from '@beetle/contracts';
import type { ValidationIdentity } from '../admission/index.js';
import { configDigest } from '../journal/index.js';
import { installedRegistrations } from './registration.js';
import { freeze, offerSnapshot, selector, snapshot, validateConfig } from './offer.js';
import { CatalogError } from './types.js';
import type { Catalog, EngineRegistration, InstalledEngine, PreflightOffer } from './types.js';

/** Trusted local installation only. No I/O or engine semantic compilation. */
export function createEngineCatalog(registrations: readonly EngineRegistration[]): Catalog {
  const engines = installedRegistrations(registrations);
  const lookup = new Map(engines.map(engine => [selector({ id: engine.manifest.engineId,
    imageDigest: engine.manifest.imageDigest, configVersion: engine.configVersion }), engine]));
  function preflight(input: unknown): PreflightOffer {
    try {
      const offer = offerSnapshot(input);
      const engine = lookup.get(selector(offer.engine));
      if (!engine) throw new CatalogError('unapproved_engine');
      validateConfig(offer, engine);
      return freeze({ offer, engine, validation: { ...engine.validation, configDigest: configDigest(offer.config) } });
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('invalid_offer');
    }
  }
  function resolve(offer: Offer, validation: ValidationIdentity): Readonly<InstalledEngine> {
    try {
      const persisted = snapshot<ValidationIdentity>(validation, 4096);
      const found = preflight(offer);
      const keys = ['manifestId', 'profileId', 'schemaDigest', 'catalogVersion', 'configDigest'] as const;
      if (Object.keys(persisted).length !== keys.length || !keys.every(key => persisted[key] === found.validation[key])) {
        throw new CatalogError('identity');
      }
      return found.engine;
    } catch { throw new CatalogError('identity'); }
  }
  return Object.freeze({ engines, preflight, resolve });
}
