import { encodeCanonicalJson, sameInstalledIdentity, validate, validatePrimitive } from '@beetle/contracts';
import { createHash } from 'node:crypto';
import type { Capabilities } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RuntimeCeilings } from '../../../domain/settings/index.js';
import type { AgentConnectionConfiguration } from '../../../ports/runner.js';
import { CapacityError } from './disk.js';

const pooled = ['cpuMillis', 'memoryBytes', 'pids', 'outputBytes'] as const;
const controls = ['cpu', 'memory', 'pids', 'timeout', 'output'] as const;
export function requireCapacity(condition: boolean): asserts condition {
  if (!condition) throw new CapacityError();
}
export function captureConfiguration(input: AgentConnectionConfiguration): AgentConnectionConfiguration {
  const copy = JSON.parse(encodeCanonicalJson(input, 65536)) as AgentConnectionConfiguration;
  requireCapacity(validatePrimitive('uuid', copy.expectedInstallationId).ok);
  requireCapacity(Number.isSafeInteger(copy.storageAllocationBytes) && copy.storageAllocationBytes > 0);
  requireCapacity(Number.isSafeInteger(copy.freeSpaceReserveBytes) && copy.freeSpaceReserveBytes >= 0);
  requireCapacity(copy.storageAllocationBytes > copy.freeSpaceReserveBytes);
  requireCapacity(Array.isArray(copy.profiles) && copy.profiles.length >= 1 && copy.profiles.length <= 32);
  const aliases = new Set<string>(); const identities = new Set<string>();
  for (const pin of copy.profiles) {
    requireCapacity(validateApi('RunEngine', pin.engine).ok && validate('InstalledIdentity', pin.installedIdentity).ok);
    requireCapacity(!aliases.has(pin.engine.profileId)); aliases.add(pin.engine.profileId);
    const key = encodeCanonicalJson({ engine: { id: pin.engine.id, imageDigest: pin.engine.imageDigest,
      configVersion: pin.engine.configVersion }, identity: pin.installedIdentity }, 4096);
    requireCapacity(!identities.has(key)); identities.add(key);
    requireCapacity(Array.isArray(pin.requiredCapabilities) && pin.requiredCapabilities.length <= 64);
    requireCapacity(pin.requiredCapabilities.every((value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)));
  }
  return copy;
}
export function captureCapabilities(input: unknown): { frame: Capabilities; fingerprint: string } {
  const text = encodeCanonicalJson(input, 1048576);
  const result = validate('Capabilities', JSON.parse(text) as unknown);
  requireCapacity(result.ok);
  return { frame: result.value, fingerprint: createHash('sha256').update(text).digest('hex') };
}
export function checkFrame(frame: Capabilities, configuration: AgentConnectionConfiguration, now: number): void {
  const observation = frame.observation;
  requireCapacity(observation.installationId === configuration.expectedInstallationId);
  const start = observation.sampleStartedAtMs;
  requireCapacity(start <= observation.observedAtMs && observation.observedAtMs <= now);
  requireCapacity(now < observation.expiresAtMs && observation.expiresAtMs <= start + observation.observationTtlMs);
  requireCapacity(observation.guards.observedAtMs >= start && observation.guards.observedAtMs <= now);
  requireCapacity(observation.perRunStagingBytes <= observation.pool.stagingBytes);
  requireCapacity(pooled.every(key => frame.capacity[key] <= observation.pool[key]));
  checkControls(frame); checkProvenance(frame);
  configuration.profiles.forEach(pin => {
    const matching = frame.engines.filter(engine => engine.id === pin.engine.id
      && engine.imageDigest === pin.engine.imageDigest && engine.configVersion === pin.engine.configVersion
      && sameInstalledIdentity(engine.installedIdentity, pin.installedIdentity));
    requireCapacity(matching.length === 1);
    requireCapacity(pin.requiredCapabilities.every(capability => matching[0]?.capabilities.includes(capability) === true));
  });
}
function checkControls(frame: Capabilities): void {
  const observation = frame.observation;
  requireCapacity(new Set(frame.supportedControls).size === 5 && controls.every(control => frame.supportedControls.includes(control)));
  requireCapacity(['cpu', 'memory', 'pids'].every(control => observation.runtimeControls.some(value => value === control)));
  requireCapacity(observation.guards.controls.includes('timeout') && observation.guards.controls.includes('output'));
}
function checkProvenance(frame: Capabilities): void {
  const observation = frame.observation;
  requireCapacity(observation.provenance.cpuMillis === 'docker-info' && observation.provenance.memoryBytes === 'docker-info');
  requireCapacity(['pids', 'outputBytes', 'stagingBytes'].every(key =>
    observation.provenance[key as 'pids' | 'outputBytes' | 'stagingBytes'] === 'configured-policy'));
  requireCapacity(observation.diskSource === 'statfs' && observation.physicalPidCapacity === null);
}
export function ceilings(frame: Capabilities, configuration: AgentConnectionConfiguration, total: number): RuntimeCeilings {
  const pool = frame.observation.pool;
  return { pool: { cpuMillis: pool.cpuMillis, memoryBytes: pool.memoryBytes, pids: pool.pids,
    outputBytes: pool.outputBytes, concurrency: frame.observation.maxConcurrent,
    storageBytes: Math.min(total, configuration.storageAllocationBytes), freeSpaceReserveBytes: configuration.freeSpaceReserveBytes },
  perRun: { ...frame.capacity }, supportedProfiles: configuration.profiles.map(pin => pin.engine.profileId) };
}
