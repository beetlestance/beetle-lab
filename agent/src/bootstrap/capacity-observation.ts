import { encodeCanonicalJson, validate } from '@beetle/contracts';
import { createHash } from 'node:crypto';
import type { CapacityObservation } from '@beetle/contracts';
import type { PoolConfiguration, Resources } from '../admission/index.js';
import type { Catalog } from '../catalog/index.js';
import type { PublishedObservation } from '../observation/index.js';
import { AgentHttpError } from '../transport/index.js';

export function capacityPolicyDigest(configuration: PoolConfiguration, catalog: Catalog): string {
  const text = encodeCanonicalJson({ configuration,
    installedIdentities: catalog.engines.map(engine => engine.installedIdentity) }, 131072);
  return createHash('sha256').update(`beetle-lab.capacity-policy.v1\n${text}`).digest('hex');
}
export function capacityObservation(input: {
  frame: PublishedObservation; configuration: PoolConfiguration; pool: Resources;
  installationId: string; policyDigest: string;
}, now: number): CapacityObservation {
  const { frame, configuration, pool } = input; const raw = frame.observation;
  const expiresAtMs = Math.min(frame.expiresAtMs, frame.sampleStartedAtMs + configuration.observationTtlMs);
  const guards = sourceGuards(frame, expiresAtMs, now);
  const value = { installationId: input.installationId, daemonId: raw.daemonId, policyDigest: input.policyDigest,
    clock: 'local-shared-wall', source: raw.source, sampleStartedAtMs: frame.sampleStartedAtMs,
    observedAtMs: raw.observedAt, expiresAtMs, observationTtlMs: configuration.observationTtlMs,
    pool, perRunStagingBytes: Math.min(pool.stagingBytes, configuration.perRun.stagingBytes),
    maxConcurrent: configuration.maxConcurrent, provenance: { ...raw.capacityProvenance },
    diskSource: raw.diskSource, freeStagingDiskBytes: raw.freeDiskBytes, physicalPidCapacity: raw.physicalPidCapacity,
    runtimeControls: raw.controls.filter(control => ['cpu', 'memory', 'pids'].includes(control)),
    guards: { source: guards.source, observedAtMs: guards.observedAt, controls: [...guards.controls] },
    requiredSensors: [...configuration.requiredSensors],
    ...(raw.idle ? { idle: { source: raw.idle.source, observedAtMs: raw.idle.observedAt, value: raw.idle.value } } : {}),
    ...(raw.thermal ? { thermal: { source: raw.thermal.source, observedAtMs: raw.thermal.observedAt, celsius: raw.thermal.celsius } } : {}),
    ...(configuration.thermal ? { thermalPolicy: { source: configuration.thermal.source,
      configuredAtMs: configuration.thermal.configuredAt, maximumCelsius: configuration.thermal.maximumCelsius } } : {}) };
  const checked = validate('CapacityObservation', value);
  if (!checked.ok) unavailable();
  return checked.value;
}
function sourceGuards(frame: PublishedObservation, expiresAtMs: number, now: number) {
  const raw = frame.observation;
  if (!Number.isSafeInteger(now) || now < frame.sampleStartedAtMs || now >= expiresAtMs
    || raw.observedAt < frame.sampleStartedAtMs || raw.observedAt > now || !raw.guards
    || raw.guards.observedAt < frame.sampleStartedAtMs || raw.guards.observedAt > now) unavailable();
  return raw.guards;
}
function unavailable(): never { throw new AgentHttpError(503, 'budget_unavailable', 'transport'); }
