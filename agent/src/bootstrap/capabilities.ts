import type { Capabilities } from '@beetle/contracts';
import { addResources, effectivePool } from '../admission/index.js';
import type { PoolConfiguration, RuntimeObservation } from '../admission/index.js';
import type { Catalog } from '../catalog/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { ResourceObserver } from '../observation/index.js';
import { AgentHttpError } from '../transport/index.js';

/** One informational frame; only the full publisher/journal can authorize admission. */
export class CapabilityView {
  private latest: RuntimeObservation | null = null;
  constructor(private readonly options: {
    observer: ResourceObserver; configuration: PoolConfiguration; catalog: Catalog; ready(): boolean;
  }) {}
  async sample(operation: Operation): Promise<RuntimeObservation> {
    const sample = await this.options.observer.sample(operation);
    this.latest = sample.status === 'known' ? sample : null;
    return sample;
  }
  async capabilities(): Promise<Capabilities> {
    if (!this.options.ready() || !this.latest) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    const { configuration, catalog } = this.options;
    const overhead = addResources(configuration.controlReserve, configuration.headroom);
    const pool = effectivePool(configuration.pool, this.latest.capacity, overhead);
    const limit = configuration.perRun;
    const capacity = { cpuMillis: Math.min(pool.cpuMillis, limit.cpuMillis), memoryBytes: Math.min(pool.memoryBytes, limit.memoryBytes),
      pids: Math.min(pool.pids, limit.pids), outputBytes: Math.min(pool.outputBytes, limit.outputBytes), timeoutMs: configuration.maxTimeoutMs };
    if (Object.values(capacity).some(value => value < 1)) throw new AgentHttpError(503, 'budget_unavailable', 'transport');
    return { protocolVersion: '1.0', protocolVersions: ['1.0'],
      capacity,
      supportedControls: [...this.latest.controls.filter((control): control is 'cpu' | 'memory' | 'pids' =>
        ['cpu', 'memory', 'pids'].includes(control)), 'timeout', 'output'],
      engines: catalog.engines.map(engine => ({ id: engine.manifest.engineId, version: engine.manifest.engineVersion,
        imageDigest: engine.profile.imageDigest, configVersion: engine.configVersion,
        installedIdentity: engine.installedIdentity, capabilities: [...engine.manifest.capabilities] })) };
  }
}
