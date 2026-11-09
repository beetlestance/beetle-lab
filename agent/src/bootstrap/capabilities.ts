import { encodeJson } from '@beetle/contracts';
import type { Capabilities } from '@beetle/contracts';
import { addResources, effectivePool } from '../admission/index.js';
import type { PoolConfiguration } from '../admission/index.js';
import type { Catalog } from '../catalog/index.js';
import type { PublishedObservation } from '../observation/index.js';
import { AgentHttpError } from '../transport/index.js';
import { capacityObservation, capacityPolicyDigest } from './capacity-observation.js';

/** One informational frame; only the full publisher/journal can authorize admission. */
export class CapabilityView {
  private readonly configuration: PoolConfiguration;
  private readonly policyDigest: string;
  constructor(private readonly options: {
    configuration: PoolConfiguration; catalog: Catalog; published(): PublishedObservation | null; wallNow?: () => number;
  }) {
    this.configuration = JSON.parse(encodeJson(options.configuration, 65536)) as PoolConfiguration;
    this.policyDigest = capacityPolicyDigest(this.configuration, options.catalog);
  }
  async capabilities(): Promise<Capabilities> {
    const frame = this.options.published();
    if (!frame) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    const latest = frame.observation;
    if (latest.status !== 'known' || !latest.guards) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    const configuration = this.configuration; const { catalog } = this.options;
    const overhead = addResources(configuration.controlReserve, configuration.headroom);
    const pool = effectivePool(configuration.pool, latest.capacity, overhead);
    const limit = configuration.perRun;
    const capacity = { cpuMillis: Math.min(pool.cpuMillis, limit.cpuMillis), memoryBytes: Math.min(pool.memoryBytes, limit.memoryBytes),
      pids: Math.min(pool.pids, limit.pids), outputBytes: Math.min(pool.outputBytes, limit.outputBytes), timeoutMs: configuration.maxTimeoutMs };
    if (Object.values(capacity).some(value => value < 1)) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    return { protocolVersion: '1.0', protocolVersions: ['1.0'],
      capacity, observation: capacityObservation({ frame, configuration, pool,
        installationId: catalog.engines[0]!.profile.installationId, policyDigest: this.policyDigest },
      (this.options.wallNow ?? Date.now)()),
      supportedControls: [...latest.controls.filter((control): control is 'cpu' | 'memory' | 'pids' =>
        ['cpu', 'memory', 'pids'].includes(control)), ...latest.guards.controls],
      engines: catalog.engines.map(engine => ({ id: engine.manifest.engineId, version: engine.manifest.engineVersion,
        imageDigest: engine.profile.imageDigest, configVersion: engine.configVersion,
        installedIdentity: engine.installedIdentity, capabilities: [...engine.manifest.capabilities] })) };
  }
}
