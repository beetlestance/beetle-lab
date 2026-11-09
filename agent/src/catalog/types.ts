import type { EngineManifest, InstalledIdentity, Offer } from '@beetle/contracts';
import type { ConfigSchema } from '@beetle/contracts/engine-config';
import type { ApprovedProfile, ValidationIdentity } from '../admission/index.js';
import type { InstallationProfile } from '../backends/docker/index.js';

export interface EngineRegistration {
  readonly manifest: EngineManifest;
  readonly profile: InstallationProfile;
  readonly configVersion: number;
  readonly validation: Readonly<Omit<ValidationIdentity, 'configDigest'>>;
  readonly configSchema: ConfigSchema;
}
export interface InstalledEngine extends EngineRegistration {
  readonly installedIdentity: Readonly<InstalledIdentity>;
  readonly approved: Readonly<ApprovedProfile>;
}
export interface PreflightOffer {
  readonly offer: Readonly<Offer>;
  readonly engine: Readonly<InstalledEngine>;
  readonly validation: Readonly<ValidationIdentity>;
}
export interface Catalog {
  readonly engines: readonly Readonly<InstalledEngine>[];
  preflight(input: unknown): PreflightOffer;
  /** Recovery resolves exact persisted identity; never silently upgrades. */
  resolve(offer: Offer, validation: ValidationIdentity): Readonly<InstalledEngine>;
}
export type CatalogReason = 'invalid_registration' | 'invalid_offer' | 'unapproved_engine' | 'invalid_config' | 'identity';
export class CatalogError extends Error {
  constructor(readonly reason: CatalogReason) { super(`Engine catalog ${reason}`); }
}
