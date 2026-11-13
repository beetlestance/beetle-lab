import type { ProducerGate } from '../producer-gate/index.js';
import type { EngineManifest, Offer } from '@beetle/contracts';
import type { Scope, ValidationIdentity } from '../admission/index.js';
import type { DockerTransport, InstallationProfile, Operation, RuntimePlan } from '../backends/docker/index.js';
import type { Journal } from '../journal/index.js';
declare const verified: unique symbol;
export interface VerifiedRoot { readonly [verified]: true }

export type StagingReason = 'invalid_input' | 'installation' | 'reservation' | 'cancelled' | 'deadline'
  | 'recovery_required' | 'clock_fenced' | 'busy' | 'closed' | 'io' | 'provider' | 'input_integrity' | 'secret_limit';
export class StagingError extends Error {
  constructor(readonly reason: StagingReason, options?: ErrorOptions) { super(`Staging ${reason}`, options); this.name = 'StagingError'; }
}
export type StagingResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: StagingReason };
export interface InstallationConfiguration {
  readonly installationId: string; readonly stagingRoot: string; readonly expectedDaemonId: string;
  readonly agentContainer: string; readonly agentImageId: string; readonly user: string;
  readonly agentIdentity?:'socket-group-drop-v1';
}
export interface VerifyInput { readonly configuration: InstallationConfiguration; readonly transport: DockerTransport; readonly operation: Operation }
/** Private providers receive immutable identity, never the mutable caller request. IDs are opaque references. */
export interface Authority extends Readonly<Scope> { readonly installationId: string; readonly intentDigest: string }
export interface InputRequest { readonly authority: Authority; readonly input: Readonly<Offer['inputs'][number]>; readonly signal: AbortSignal }
export interface SecretRequest { readonly authority: Authority; readonly secret: Readonly<NonNullable<Offer['secretReferences']>[number]>; readonly signal: AbortSignal }
export interface Providers {
  input(request: InputRequest): Promise<AsyncIterable<Uint8Array>>;
  secret(request: SecretRequest): Promise<Uint8Array>;
}
export interface StagerOptions {
  readonly gate: ProducerGate;
  readonly root: VerifiedRoot; readonly profile: InstallationProfile; readonly manifest: EngineManifest;
  readonly validation: Omit<ValidationIdentity, 'configDigest'>; readonly journal: Journal; readonly providers: Providers;
  readonly wallNow?: () => number;
}
export interface PrepareRequest { readonly key: Scope; readonly operation: Operation }
export interface Preparation {
  readonly result: Promise<StagingResult<RuntimePlan>>;
  /** Resolve only once every issued provider/kernel operation and descriptor close has settled. */
  readonly quiesced: Promise<void>;
}
