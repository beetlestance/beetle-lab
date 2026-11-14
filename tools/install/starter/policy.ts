import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { ProvisionRequest } from '../types.js';
import { digest } from '../src/capture.js';

const MiB = 1_048_576;
/** Shipped editable policy, never a claim about observed machine capacity. */
export function starterPolicy(): Pick<ProvisionRequest, 'installationValues' | 'agentPolicy' | 'engine'> {
  const budget = { cpuMillis: 1000, memoryBytes: 512 * MiB, pids: 128, timeoutMs: 300_000, outputBytes: 64 * MiB };
  const reserve = { cpuMillis: 250, memoryBytes: 128 * MiB, pids: 16, outputBytes: 0, stagingBytes: 0 };
  return {
    installationValues: {
      pool: { cpuMillis: 2000, memoryBytes: 1024 * MiB, pids: 256, outputBytes: 128 * MiB,
        concurrency: 2, storageBytes: 2048 * MiB, freeSpaceReserveBytes: 256 * MiB },
      perRunCeilings: { ...budget }, supportedProfiles: ['k6-local'],
      runDefaults: { engineProfile: 'k6-local', budget: { ...budget } }, retention: { mode: 'manual' },
    },
    agentPolicy: {
      pool: { cpuMillis: 2000, memoryBytes: 1024 * MiB, pids: 256, outputBytes: 128 * MiB, stagingBytes: 128 * MiB },
      perRun: { cpuMillis: 1000, memoryBytes: 512 * MiB, pids: 128, outputBytes: 64 * MiB, stagingBytes: 64 * MiB },
      controlReserve: { cpuMillis: 1350, memoryBytes: 576 * MiB, pids: 160, outputBytes: 0, stagingBytes: 0 }, headroom: { ...reserve }, maxConcurrent: 2,
      maxTimeoutMs: 300_000, observationTtlMs: 1000, requiredSensors: [],
    },
    engine: {
      manifestId: 'k6-v1', profileId: 'k6-local', catalogVersion: 1, configVersion: 1, tmpfsBytes: 16 * MiB,
      manifest: {
        protocolVersion: '1.0', engineId: 'k6', engineVersion: '2.4.0', imageDigest: 'sha256:' + '0'.repeat(64),
        protocolRange: { minimum: '1.0', maximum: '1.0' },
        schemas: { config: createK6ConfigSchema(digest).schemaId, result: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' },
        capabilities: ['http'], supportedControls: ['cpu', 'memory', 'pids', 'timeout', 'output'],
        defaultBudget: { ...budget }, minimumBudget: { ...budget, timeoutMs: 1, outputBytes: 1 },
        backends: ['docker'], network: { required: true, profile: 'target-egress' },
        phases: (['validate', 'prepare', 'execute', 'collect', 'seal'] as const).map(phase => ({
          phase, timeoutMs: phase === 'execute' || phase === 'prepare' ? budget.timeoutMs : 5000, workUnits: 100,
          outputBytes: phase === 'execute' ? budget.outputBytes : 4 * MiB,
        })),
        entrypoint: { executable: 'node', arguments: ['/beetle/bootstrap/main.js'] },
      },
    },
  };
}
