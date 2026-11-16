import type { AdmissionSnapshot, ApprovedProfile, Candidate, Decision, Resources, RuntimeObservation } from './types.js';
import { addResources, effectivePool, fits, zeroResources } from './resources.js';
import { supportedStaging } from './staging.js';
import { captureDiskRetention, DISK_HOLD_LIMIT } from './retention.js';
import type { DiskRetention } from './retention.js';
import { retainedFit } from './retention-policy.js';

export const PROMOTION_MS = 30_000;
export const MAX_SCAN = 100;
export function approvedProfile(candidate: Candidate, profiles: ApprovedProfile[]): ApprovedProfile | undefined {
  return profiles.find(profile => profile.manifestId === candidate.validation.manifestId &&
    profile.profileId === candidate.validation.profileId && profile.schemaDigest === candidate.validation.schemaDigest &&
    profile.catalogVersion === candidate.validation.catalogVersion && profile.engineId === candidate.engine.id &&
    profile.imageDigest === candidate.engine.imageDigest && profile.configVersion === candidate.engine.configVersion);
}
export function validateCandidate(candidate: Candidate, snapshot: AdmissionSnapshot): Decision {
  if (!supportedStaging(candidate.staging, candidate.resources.stagingBytes)) return { kind: 'reject', reason: 'staging_policy' };
  if (candidate.requiredCapabilities.includes('hard-output-quota')) return { kind: 'reject', reason: 'unsupported_capability' };
  const profile = approvedProfile(candidate, snapshot.configuration.profiles);
  if (!profile) return { kind: 'reject', reason: 'unapproved_profile' };
  if (belowMinimum(candidate, profile)) return { kind: 'reject', reason: 'below_manifest_minimum' };
  if (!fits(candidate.resources, snapshot.configuration.perRun)) return { kind: 'reject', reason: 'per_run_ceiling' };
  if (candidate.budget.timeoutMs > snapshot.configuration.maxTimeoutMs) return { kind: 'reject', reason: 'timeout_ceiling' };
  if (!fits(candidate.resources, snapshot.configuration.pool)) return { kind: 'reject', reason: 'impossible_request' };
  if (candidate.requiredCapabilities.some(capability => !profile.capabilities.includes(capability))) {
    return { kind: 'reject', reason: 'unsupported_capability' };
  }
  return { kind: 'admit' };
}
function belowMinimum(candidate: Candidate, profile: ApprovedProfile): boolean {
  return !Number.isSafeInteger(profile.minimum.timeoutMs) || profile.minimum.timeoutMs <= 0 ||
    !fits(profile.minimum, candidate.resources) || candidate.budget.timeoutMs < profile.minimum.timeoutMs;
}
function fresh(timestamp: number, snapshot: AdmissionSnapshot): boolean {
  return timestamp <= snapshot.now && snapshot.now - timestamp <= snapshot.configuration.observationTtlMs;
}
function idleDecision(candidate: Candidate, observation: RuntimeObservation, snapshot: AdmissionSnapshot): Decision {
  const idle = observation.idle;
  const knownIdle = idle && fresh(idle.observedAt, snapshot) && idle.value !== null;
  if (snapshot.configuration.requiredSensors.includes('idle') && !knownIdle) return { kind: 'defer', reason: 'idle_unknown' };
  if (candidate.preferIdle && knownIdle && idle.value === false) return { kind: 'defer', reason: 'runtime_busy' };
  return { kind: 'admit' };
}
function thermalDecision(observation: RuntimeObservation, snapshot: AdmissionSnapshot): Decision {
  const { requiredSensors, thermal } = snapshot.configuration;
  const sensor = observation.thermal;
  const knownThermal = sensor && fresh(sensor.observedAt, snapshot) && sensor.celsius !== null;
  if (requiredSensors.includes('thermal') && !knownThermal) return { kind: 'defer', reason: 'thermal_unknown' };
  if (thermal && knownThermal && sensor.celsius !== null && sensor.celsius > thermal.maximumCelsius) {
    return { kind: 'defer', reason: 'thermal_busy' };
  }
  return { kind: 'admit' };
}
function fairness(candidate: Candidate, snapshot: AdmissionSnapshot, pool: Resources, used: Resources, retention: DiskRetention): Decision {
  for (const older of snapshot.queue.slice(0, MAX_SCAN)) {
    if (older.order >= candidate.order) break;
    if (validateCandidate(older, snapshot).kind !== 'admit' || !fits(older.resources, pool)) continue;
    const promoted = older.queuedAt === null || snapshot.now - older.queuedAt >= PROMOTION_MS;
    if (promoted) return { kind: 'defer', reason: 'promoted_predecessor' };
    if (retainedFit(older.resources, used, pool, retention)) return { kind: 'defer', reason: 'fifo_predecessor' };
  }
  return { kind: 'admit' };
}
export function decideAdmission(candidate: Candidate, snapshot: AdmissionSnapshot, retention: DiskRetention): Decision {
  const held = captureDiskRetention(retention);
  const validation = validateCandidate(candidate, snapshot);
  if (validation.kind !== 'admit') return validation;
  if (snapshot.now < snapshot.lastClock) return { kind: 'defer', reason: 'clock_rollback' };
  const observation = snapshot.observation;
  if (!observation || observation.status !== 'known' || !fresh(observation.observedAt, snapshot)) {
    return { kind: 'defer', reason: 'capacity_unknown' };
  }
  const controls = controlDecision(candidate, observation, snapshot);
  if (controls.kind !== 'admit') return controls;
  const overhead = addResources(snapshot.configuration.controlReserve, snapshot.configuration.headroom);
  const pool = effectivePool(snapshot.configuration.pool, observation.capacity, overhead);
  if (!fits(candidate.resources, pool)) return { kind: 'reject', reason: 'impossible_request' };
  const sensors = idleDecision(candidate, observation, snapshot);
  if (sensors.kind !== 'admit') return sensors;
  const thermal = thermalDecision(observation, snapshot);
  if (thermal.kind !== 'admit') return thermal;
  const diskFree = Math.max(0, observation.freeDiskBytes - overhead.outputBytes - overhead.stagingBytes);
  return capacityDecision(candidate, snapshot, pool, diskFree, held);
}
function controlDecision(candidate: Candidate, observation: RuntimeObservation, snapshot: AdmissionSnapshot): Decision {
  const profile = approvedProfile(candidate, snapshot.configuration.profiles);
  const guards = observation.guards;
  if (!guards || !fresh(guards.observedAt, snapshot)) return { kind: 'reject', reason: 'controls_unavailable' };
  const runtime = observation.controls.filter(control => control !== 'timeout' && control !== 'output');
  const supported = new Set([...runtime, ...guards.controls]);
  if (profile?.controls.some(control => !supported.has(control))) return { kind: 'reject', reason: 'controls_unavailable' };
  return { kind: 'admit' };
}
function capacityDecision(candidate: Candidate, snapshot: AdmissionSnapshot, pool: Resources, freeDiskBytes: number, retention: DiskRetention): Decision {
  const active = snapshot.reservations.filter(item => item.status === 'charged');
  if (active.length >= snapshot.configuration.maxConcurrent || active.length >= 64) return { kind: 'defer', reason: 'concurrency' };
  if (active.some(item => item.mode === 'isolated') || (candidate.mode === 'isolated' && active.length > 0)) {
    return { kind: 'defer', reason: 'isolated' };
  }
  const used = active.reduce((sum, item) => addResources(sum, item.resources), zeroResources());
  const fair = fairness(candidate, snapshot, pool, used, retention);
  if (fair.kind !== 'admit') return fair;
  if (retention.heldCount >= DISK_HOLD_LIMIT) return { kind: 'defer', reason: 'retention_capacity' };
  if (!retainedFit(candidate.resources, used, pool, retention)) return { kind: 'defer', reason: 'budget_unavailable' };
  return nativeDiskDecision(used, candidate.resources, freeDiskBytes,retention.cleanupBytes);
}
function nativeDiskDecision(used: Resources, candidate: Resources, freeDiskBytes: number,cleanupBytes:number): Decision {
  if(cleanupBytes>freeDiskBytes)return {kind:'defer',reason:'disk_unavailable'};
  freeDiskBytes-=cleanupBytes;
  const disk = addResources(used, candidate);
  if (disk.outputBytes > freeDiskBytes || disk.stagingBytes > freeDiskBytes - disk.outputBytes) {
    return { kind: 'defer', reason: 'disk_unavailable' };
  }
  return { kind: 'admit' };
}
