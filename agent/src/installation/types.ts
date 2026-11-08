import type { AttemptSnapshot } from '@beetle/contracts';
import type { Decision, Reservation, Scope } from '../admission/index.js';
import type { Catalog, InstalledEngine } from '../catalog/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { AttemptProgress } from '../controller/index.js';
import type { Journal } from '../journal/index.js';
import type { Stager } from '../staging/index.js';
import type { Supervisor } from '../supervisor/index.js';

export interface InstallationOptions {
  readonly journal: Journal;
  readonly catalog: Catalog;
  readonly supervisor: Supervisor;
  /** Trusted lookup of preconfigured, verified Stager services; never job-supplied paths/providers. */
  stagerFor(engine: Readonly<InstalledEngine>): Pick<Stager, 'prepare'>;
  readonly wallNow?: () => number;
}
export type OfferAcceptance = { readonly accepted: true; readonly snapshot: AttemptSnapshot }
  | { readonly accepted: false; readonly decision: Exclude<Decision, { kind: 'admit' }> };
export type DriveProgress = AttemptProgress | { readonly kind: 'deferred' | 'rejected'; readonly reason: string };
export interface InstallationAttempt {
  readonly snapshot: AttemptSnapshot;
  /** Private app/installation observation; transport must never expose launch capabilities verbatim. */
  readonly allocation: Reservation | null;
}
export interface InstallationController {
  enqueue(input: unknown): Promise<OfferAcceptance>;
  drive(key: Scope, operation: Operation): Promise<DriveProgress>;
  /** Persist intent and fence owned work; signalling/draining may remain outstanding. */
  cancel(key: Scope): Promise<AttemptSnapshot>;
  /** Private output guard stop; not a runner HTTP operation or a user cancellation. */
  stop(key: Scope, reason: 'output_limit' | 'artifact_incomplete'): Promise<AttemptSnapshot>;
  inspect(key: Scope): Promise<InstallationAttempt>;
  /** Original preparation/driver/controller work is retained through shutdown. Journal ownership is external. */
  close(): Promise<void>;
}
export type InstallationReason = 'invalid_input' | 'closed' | 'busy' | 'capacity' | 'journal'
  | 'catalog' | 'staging' | 'controller' | 'clock' | 'cleanup';
export class InstallationError extends Error {
  constructor(readonly reason: InstallationReason) { super(`Installation controller ${reason}`); }
}
