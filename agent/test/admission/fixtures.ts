import type { Offer } from '@beetle/contracts';
import type { AdmissionValue, PoolConfiguration, Reservation, Resources, RuntimeObservation, Scope, ValidationIdentity } from '../../src/admission/index.js';
import { configDigest } from '../../src/journal/admission-input.js';
import type { Journal } from '../../src/journal/index.js';
import { journalFixture } from '../journal/fixtures.js';

export const now = 100_000;
export const digest = 'b'.repeat(64);
// Disk includes the prescribed bounded offer/manifest/metadata staging for every attempt.
export const vector = (cpuMillis = 4000): Resources => ({ cpuMillis, memoryBytes: 4000, pids: 40, outputBytes: 4000, stagingBytes: 10_000_000 });
export function configuration(): PoolConfiguration {
  return { pool: vector(), perRun: vector(), controlReserve: { cpuMillis: 100, memoryBytes: 100, pids: 1, outputBytes: 0, stagingBytes: 0 },
    headroom: { cpuMillis: 100, memoryBytes: 100, pids: 1, outputBytes: 0, stagingBytes: 0 },
    maxConcurrent: 4, maxTimeoutMs: 1000, observationTtlMs: 1000, requiredSensors: [], profiles: [{
      manifestId: 'k6-v1', profileId: 'locked', engineId: 'k6', imageDigest: `sha256:${'a'.repeat(64)}`,
      configVersion: 1, schemaDigest: digest, catalogVersion: 1,
      minimum: { cpuMillis: 100, memoryBytes: 100, pids: 1, outputBytes: 1, stagingBytes: 0, timeoutMs: 1 },
      capabilities: ['http'], controls: ['cpu', 'memory', 'pids', 'timeout', 'output'],
    }] };
}
export function observation(at = now): RuntimeObservation {
  return { source: 'synthetic-runtime', observedAt: at, status: 'known', capacity: { ...vector(5000), memoryBytes: 5000, pids: 50 },
    freeDiskBytes: 20_000_000, controls: ['cpu', 'memory', 'pids'],
    guards: { source: 'supervisor', observedAt: at, controls: ['timeout', 'output'] },
    idle: { source: 'synthetic-idle', observedAt: at, value: true } };
}
export function validation(offer: Offer): ValidationIdentity {
  return { manifestId: 'k6-v1', profileId: 'locked', schemaDigest: digest, catalogVersion: 1, configDigest: configDigest(offer.config) };
}
export function scope(offer: Offer): Scope {
  return { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId, generation: 1 };
}
export function reserved(value: AdmissionValue): Reservation {
  if (!('status' in value)) throw new Error(`Expected reservation: ${JSON.stringify(value)}`);
  return value;
}
export function admissionFixture() {
  const f = journalFixture();
  return {
    ...f,
    job(id = 1, cpuMillis = 1000): Offer {
      const value = f.offer(); value.attemptId = `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`;
      value.organizationId = `00000000-0000-4000-8001-${id.toString().padStart(12, '0')}`;
      value.budget = { cpuMillis, memoryBytes: 1000, pids: 10, outputBytes: 100, timeoutMs: 1000 };
      value.executionPolicy.preferIdle = false;
      return value;
    },
    async configured(path?: string, quota?: number): Promise<Journal> {
      const journal = await f.open(path, quota);
      await journal.admission({ kind: 'configure', configuration: configuration() });
      await journal.admission({ kind: 'observe', observation: observation() });
      return journal;
    },
    async enqueue(journal: Journal, offer: Offer, at = now): Promise<AdmissionValue> {
      return journal.admission({ kind: 'offer', offer, validation: validation(offer), now: at });
    },
    async admit(journal: Journal, offer: Offer, at = now, sourceOrdinal = 1): Promise<AdmissionValue> {
      return journal.admission({ kind: 'admit', key: scope(offer), sourceOrdinal, now: at });
    },
  };
}
