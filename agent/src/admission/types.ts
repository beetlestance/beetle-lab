import type { Offer } from '@beetle/contracts';
import type { StagingEstimate } from './staging.js';

export const resourceNames = ['cpuMillis', 'memoryBytes', 'pids', 'outputBytes', 'stagingBytes'] as const;
export type Resources = Record<typeof resourceNames[number], number>;
export interface Scope { attemptId: string; organizationId: string; workspaceId: string; generation: number }
export interface ApprovedProfile {
  manifestId: string; profileId: string; engineId: string; imageDigest: string; configVersion: number;
  schemaDigest: string; catalogVersion: number; minimum: Resources & { timeoutMs: number }; capabilities: string[]; controls: string[];
}
export interface PoolConfiguration {
  pool: Resources; perRun: Resources; controlReserve: Resources; headroom: Resources;
  maxConcurrent: number; maxTimeoutMs: number; observationTtlMs: number; profiles: ApprovedProfile[];
  requiredSensors: ('idle' | 'thermal')[];
  thermal?: { maximumCelsius: number; source: string; configuredAt: number };
}
export interface RuntimeObservation {
  source: string; observedAt: number; status: 'known' | 'unknown'; capacity: Resources;
  freeDiskBytes: number; controls: string[];
  guards?: { source: 'supervisor'; observedAt: number; controls: ('timeout' | 'output')[] };
  idle?: { source: string; observedAt: number; value: boolean | null };
  thermal?: { source: string; observedAt: number; celsius: number | null };
}
/** Trusted installed-schema/metadata preflight identity, not full engine compilation evidence. */
export interface ValidationIdentity {
  manifestId: string; profileId: string; schemaDigest: string; catalogVersion: number; configDigest: string;
}
export interface Candidate extends Scope {
  staging: Readonly<StagingEstimate>;
  resources: Resources; budget: Offer['budget']; mode: 'parallel' | 'isolated'; preferIdle: boolean;
  requiredCapabilities: string[]; engine: Offer['engine']; validation: ValidationIdentity;
  queuedAt: number | null; order: number;
}
export interface Reservation extends Candidate {
  status: 'charged' | 'released'; admittedAt: number; createToken: string | null;
  specDigest: string | null; runtimeId: string | null; startToken: string | null;
  launchEpoch: 0 | 1; startClaimedAt: number | null; launchClosed: boolean; launchSettlement: LaunchSettlement | null;
  aborted: boolean; releaseEvidence: ReleaseEvidence | null;
}
export interface LaunchSettlement {
  authority: 'supervisor'; key: Scope; createToken: string; specDigest: string; runtimeId: string;
  epoch: 0 | 1; startToken: string | null; disposition: 'completed' | 'retired' | 'unknown';
  settledAt: number; evidenceId: string;
}
export interface ReleaseEvidence {
  authority: 'supervisor'; key: Scope; createToken: string; specDigest: string; runtimeId: string;
  runtime: { state: 'stopped' | 'absent'; source: 'supervisor'; observedAt: number; evidenceId: string };
  collection: { state: 'finished' | 'failed'; observedAt: number; evidenceId: string };
  launch: { epoch: 0 | 1; startToken: string | null; settlementId: string };
}
export type Decision = { kind: 'admit' } | { kind: 'defer' | 'reject'; reason: string };
export interface AdmissionSnapshot {
  configuration: PoolConfiguration; observation: RuntimeObservation | null; now: number;
  reservations: Reservation[]; queue: Candidate[]; lastClock: number;
}
export type AdmissionCommand =
  | { kind: 'configure'; configuration: PoolConfiguration }
  | { kind: 'observe'; observation: RuntimeObservation }
  | { kind: 'offer'; offer: Offer; validation: ValidationIdentity; now: number }
  | { kind: 'admit'; key: Scope; sourceOrdinal: number; now: number }
  | { kind: 'reservations'; limit: number; cursor?: number }
  | { kind: 'reservation'; key: Scope }
  | { kind: 'claimCreate'; key: Scope; specDigest: string }
  | { kind: 'bindRuntime'; key: Scope; createToken: string; specDigest: string; runtimeId: string }
  | { kind: 'claimStart'; key: Scope; createToken: string; specDigest: string; runtimeId: string; now: number }
  | { kind: 'settleLaunch'; settlement: LaunchSettlement }
  | { kind: 'release'; evidence: ReleaseEvidence }
  | { kind: 'abortUnstarted'; key: Scope };
export type AdmissionValue = Decision | Reservation | { reservation: Reservation; dispatchAllowed: boolean; token: string } |
  { reservations: Reservation[]; cursor?: number } | { stored: boolean };
