import { createHash } from 'node:crypto';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { AdmissionCommand, ApprovedProfile, PoolConfiguration, Resources, RuntimeObservation, Scope, ValidationIdentity } from '../admission/index.js';
import { addResources, validResources } from '../admission/index.js';
import { canonical, offerInput } from './input.js';

function requireValid(condition: unknown): asserts condition { if (!condition) throw new Error('invalid_input'); }
function integer(value: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function text(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function digest(value: string): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function strings(value: string[]): boolean { return Array.isArray(value) && value.length <= 64 && value.every(text); }
function resources(value: Resources): void {
  requireValid(value && validResources(value));
  requireValid(Object.values(value).every(item => integer(item, Math.floor(Number.MAX_SAFE_INTEGER / 256))));
}
function scope(key: Scope): void {
  requireValid(key && [key.attemptId, key.organizationId, key.workspaceId].every(value => validatePrimitive('uuid', value).ok));
  requireValid(integer(key.generation) && key.generation > 0);
}
function identity(value: ValidationIdentity): void {
  requireValid(value && text(value.manifestId) && text(value.profileId));
  requireValid(digest(value.schemaDigest) && digest(value.configDigest) && integer(value.catalogVersion) && value.catalogVersion > 0);
}
function profile(value: ApprovedProfile): void {
  requireValid(value && text(value.manifestId) && text(value.profileId) && text(value.engineId));
  requireValid(typeof value.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.imageDigest) && digest(value.schemaDigest));
  requireValid(integer(value.configVersion) && value.configVersion > 0 && integer(value.catalogVersion) && value.catalogVersion > 0);
  resources(value.minimum); requireValid(strings(value.capabilities) && strings(value.controls));
  requireValid(['cpu', 'memory', 'pids', 'timeout', 'output'].every(control => value.controls.includes(control)));
}
function configuration(value: PoolConfiguration): void {
  requireValid(value);
  for (const budget of [value.pool, value.perRun, value.controlReserve, value.headroom]) resources(budget);
  addResources(value.controlReserve, value.headroom);
  requireValid(integer(value.maxConcurrent, 64) && value.maxConcurrent > 0);
  requireValid(integer(value.maxTimeoutMs) && value.maxTimeoutMs > 0);
  requireValid(integer(value.observationTtlMs, 300_000) && value.observationTtlMs > 0);
  requireValid(Array.isArray(value.profiles) && value.profiles.length > 0 && value.profiles.length <= 32);
  value.profiles.forEach(profile);
  requireValid(Array.isArray(value.requiredSensors) && value.requiredSensors.length <= 2);
  requireValid(value.requiredSensors.every(sensor => sensor === 'idle' || sensor === 'thermal'));
  thermalConfiguration(value);
}
function thermalConfiguration(value: PoolConfiguration): void {
  if (!value.thermal) return;
  requireValid(Number.isFinite(value.thermal.maximumCelsius) && value.thermal.maximumCelsius >= -100 && value.thermal.maximumCelsius <= 300);
  requireValid(text(value.thermal.source) && integer(value.thermal.configuredAt));
}
function observation(value: RuntimeObservation): void {
  requireValid(value && text(value.source) && integer(value.observedAt));
  requireValid(value.status === 'known' || value.status === 'unknown');
  resources(value.capacity); requireValid(integer(value.freeDiskBytes) && strings(value.controls));
  idleObservation(value); thermalObservation(value); guardObservation(value);
}
function guardObservation(value: RuntimeObservation): void {
  if (!value.guards) return;
  requireValid(value.guards.source === 'supervisor' && integer(value.guards.observedAt));
  requireValid(Array.isArray(value.guards.controls) && value.guards.controls.length <= 2);
  requireValid(value.guards.controls.every(control => control === 'timeout' || control === 'output'));
}
function idleObservation(value: RuntimeObservation): void {
  if (value.idle) {
    requireValid(text(value.idle.source) && integer(value.idle.observedAt));
    requireValid(value.idle.value === null || typeof value.idle.value === 'boolean');
  }
}
function thermalObservation(value: RuntimeObservation): void {
  if (value.thermal) {
    requireValid(text(value.thermal.source) && integer(value.thermal.observedAt));
    requireValid(value.thermal.celsius === null || (Number.isFinite(value.thermal.celsius) && value.thermal.celsius >= -100 && value.thermal.celsius <= 300));
  }
}
function release(input: Extract<AdmissionCommand, { kind: 'release' }>): void {
  const value = input.evidence; requireValid(value && value.authority === 'supervisor'); scope(value.key);
  requireValid(text(value.createToken) && digest(value.specDigest) && text(value.runtimeId));
  requireValid(value.runtime && ['stopped', 'absent'].includes(value.runtime.state));
  requireValid(value.runtime.source === 'supervisor' && integer(value.runtime.observedAt) && text(value.runtime.evidenceId));
  requireValid(value.collection && ['finished', 'failed'].includes(value.collection.state));
  requireValid(integer(value.collection.observedAt) && text(value.collection.evidenceId));
}
function ownership(input: AdmissionCommand): void {
  if ('key' in input) scope(input.key);
  switch (input.kind) {
    case 'admit': admitInput(input); return;
    case 'claimCreate': requireValid(digest(input.specDigest)); return;
    case 'bindRuntime': case 'claimStart':
      requireValid(text(input.createToken) && digest(input.specDigest) && text(input.runtimeId)); return;
    case 'reservation': case 'abortUnstarted': return;
    default: throw new Error('invalid_input');
  }
}
function admitInput(input: Extract<AdmissionCommand, { kind: 'admit' }>): void {
  requireValid(integer(input.now, 8_640_000_000_000_000));
  requireValid(integer(input.sourceOrdinal) && input.sourceOrdinal > 0);
}
export function configDigest(config: unknown): string {
  const copy: unknown = JSON.parse(encodeJson(config, 1_048_576));
  return createHash('sha256').update(canonical(copy)).digest('hex');
}
export function admissionInput(input: AdmissionCommand): AdmissionCommand {
  const copy = JSON.parse(encodeJson(input, 1_114_112)) as AdmissionCommand;
  requireValid(copy && typeof copy === 'object');
  switch (copy.kind) {
    case 'configure': configuration(copy.configuration); break;
    case 'observe': observation(copy.observation); break;
    case 'offer': {
      const offer = JSON.parse(offerInput(copy.offer).json) as typeof copy.offer;
      identity(copy.validation); requireValid(integer(copy.now));
      requireValid(configDigest(offer.config) === copy.validation.configDigest); break;
    }
    case 'reservations':
      requireValid(integer(copy.limit, 100) && copy.limit > 0);
      if (copy.cursor !== undefined) requireValid(integer(copy.cursor)); break;
    case 'release': release(copy); break;
    default: ownership(copy);
  }
  if (copy.kind !== 'offer') encodeJson(copy, 65_536);
  return copy;
}
