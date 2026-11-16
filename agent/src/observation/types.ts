import type { PoolConfiguration, RuntimeObservation } from '../admission/index.js';
import type { DockerTransport, Operation } from '../backends/docker/index.js';
import type { VerifiedRoot } from '../staging/index.js';

export interface ObserverOptions {
  readonly root: VerifiedRoot;
  readonly transport: DockerTransport;
  readonly configuration: Pick<PoolConfiguration, 'pool' | 'controlReserve' | 'headroom'>;
  readonly wallNow?: () => number;
}
export interface ResourceObserver {
  /** One original at a time. Operational failures return an explicitly unknown sample. */
  sample(operation: Operation): Promise<RuntimeObservation>;
  /** Aborts sampling and waits for its original; shared transport lifetime remains external. */
  close(): Promise<void>;
}
export class ObserverError extends Error {
  constructor(readonly reason: 'invalid_input' | 'busy' | 'closed') { super(`Resource observer ${reason}`); }
}
