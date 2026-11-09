import { RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import { MAX_ATTEMPT_OBSERVATION_BYTES } from '../domain/runs/index.js';
import type { AttemptIdentity } from '../domain/runs/index.js';
import type { AttemptSnapshot } from '@beetle/contracts';

export const DISPATCH_SCAN_LIMIT = 32;
export const DISPATCH_CURSOR_BYTES = 1024;
export const DISPATCH_PAGE_BYTES = 65_536;
export const DISPATCH_OFFER_REPLY_BYTES = RUNNER_MAXIMUM_OFFER_BYTES + 65_536;
export const DISPATCH_OBSERVATION_REQUEST_BYTES = MAX_ATTEMPT_OBSERVATION_BYTES + 2048;
export const MAX_DISPATCH_PENDING = 4096;
export const MAX_DISPATCH_CHARGED = 64;
export const RUN_OUTPUT_METADATA_BYTES = 65_536;

/** Captured original identity; the first release only acknowledges generation1. */
export interface DispatchKey {
  readonly runId: string;
  readonly attempt: AttemptIdentity & { generation: 1 };
}
export type DispatchBlockReason = 'capacity_unknown' | 'profile_unavailable' | 'per_run_ceiling' |
  'budget_unavailable' | 'staging_unavailable' | 'storage_unavailable' | 'isolated' |
  'isolated_predecessor' | 'not_queued' | 'untracked_intent' | 'ownership_unknown';
export type DispatchEligibility = { readonly kind: 'ready' } |
  { readonly kind: 'blocked'; readonly reason: DispatchBlockReason };
export interface DispatchScan {
  readonly lane: 'queued' | 'reconcile';
  readonly limit: number;
  readonly cursor?: string;
}
export interface DispatchCandidate {
  readonly key: DispatchKey;
  readonly order: number;
  /** Query-bound continuation after this item, within the captured upper order. */
  readonly after: string;
  readonly eligibility: DispatchEligibility;
}
export interface DispatchPage {
  readonly items: readonly DispatchCandidate[];
  readonly nextCursor: string | null;
}
export interface DispatchOffer { readonly key: DispatchKey; readonly offer: Offer }
export type DispatchClaim = { readonly kind: 'claimed' | 'replay'; readonly key: DispatchKey; readonly journalAuthority: string } |
  { readonly kind: 'acknowledged'; readonly journalAuthority: string } | { readonly kind: 'blocked'; readonly reason: DispatchBlockReason };
export interface DispatchObservationRequest { readonly key: DispatchKey; readonly snapshot: unknown; readonly journalAuthority: string }
export interface DispatchObservation {
  readonly run: Run;
  readonly snapshot: Readonly<AttemptSnapshot>;
  readonly executionCharged: boolean;
  readonly runChanged: boolean;
}

/** Private installation-wide port. Discovery never authorizes network effects.
 * Read the one bounded original Offer, then durably claim before PUT. Only claimed
 * or replay permits that same original. Ambiguous outcomes retain charge.
 * Observe binds/merges/ACKs/releases execution charge in one worker transaction;
 * output storage, event ACK and result finalization have separate authority.
 * No network I/O or retry in SQL; Metadata owns original completion and shutdown.
 */
export interface DispatchStore {
  scan(query: DispatchScan): Promise<DispatchPage>;
  readOffer(key: DispatchKey): Promise<DispatchOffer>;
  claim(key: DispatchKey): Promise<DispatchClaim>;
  observe(request: DispatchObservationRequest): Promise<DispatchObservation>;
}
