import { createHash } from 'node:crypto';
import { captureStandaloneExportAssignment, encodeCanonicalJson, RUNNER_MAXIMUM_OFFER_BYTES, sameInstalledIdentity } from '@beetle/contracts';
import type { Offer, StandaloneExportAssignment } from '@beetle/contracts';
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
  function checked(input: unknown, exporting = false): PreflightOffer {
    try {
      const offer = offerSnapshot(input);
      const engine = lookup.get(selector(offer.engine));
      if (!engine) throw new CatalogError('unapproved_engine');
      requirePurpose(offer,engine,exporting);
      if (!sameInstalledIdentity(offer.installedIdentity, engine.installedIdentity)) throw new CatalogError('identity');
      validateConfig(offer, engine);
      return freeze({ offer, engine, validation: { ...engine.validation, configDigest: configDigest(offer.config) } });
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('invalid_offer');
    }
  }
  function preflight(input: unknown): PreflightOffer {return checked(input);}
  function preflightExport(input: unknown): PreflightOffer & {readonly assignment: StandaloneExportAssignment} {
    try {
      const assignment=captureStandaloneExportAssignment(input,text=>createHash('sha256').update(text).digest('hex'));
      return freeze({...checked(assignment.offer,true),assignment});
    } catch (error) {if (error instanceof CatalogError) throw error; throw new CatalogError('invalid_offer');}
  }
  function resolve(offer: Offer, validation: ValidationIdentity, assignment?: StandaloneExportAssignment | null): Readonly<InstalledEngine> {
    try {
      const persisted = snapshot<ValidationIdentity>(validation, 4096);
      const found = assignment ? preflightExport(assignment) : preflight(offer);
      if (encodeCanonicalJson(found.offer,RUNNER_MAXIMUM_OFFER_BYTES) !== encodeCanonicalJson(offer,RUNNER_MAXIMUM_OFFER_BYTES)) throw new CatalogError('identity');
      const keys = ['manifestId', 'profileId', 'schemaDigest', 'catalogVersion', 'configDigest'] as const;
      if (Object.keys(persisted).length !== keys.length || !keys.every(key => persisted[key] === found.validation[key])) {
        throw new CatalogError('identity');
      }
      return found.engine;
    } catch { throw new CatalogError('identity'); }
  }
  return Object.freeze({ engines, preflight, preflightExport, resolve });
}

function requirePurpose(offer:Offer,engine:Readonly<InstalledEngine>,exporting:boolean):void {
      const schema = 'https://beetle-lab.dev/contracts/runner/v1/' + (exporting ? 'export-result' : 'engine-result');
      if (engine.manifest.schemas.result !== schema || exporting && !engine.manifest.capabilities.includes('standalone-export-v1')) throw new CatalogError('unapproved_engine');
      if (!exporting && offer.requiredCapabilities.includes('standalone-export-v1')) throw new CatalogError('invalid_offer');
}
