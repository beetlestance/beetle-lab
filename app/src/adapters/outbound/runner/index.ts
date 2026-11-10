import type { LoadedAgentConfiguration } from '../../../ports/runner.js';
import type { RunnerOutputAbsenceGateway } from '../../../ports/output-absence.js';
import { openGateway } from './gateway.js';
import { nativeIo } from './native.js';

/** Installation-owned, bounded Node HTTP gateway. Closing retains original I/O. */
export function createRunnerGateway(loaded: LoadedAgentConfiguration): RunnerOutputAbsenceGateway {
  return openGateway(loaded, nativeIo);
}

export { startDeliveryRuntime } from './delivery/index.js';
export { eventDiscovery as createEventDiscovery } from './delivery/event-discovery.js';
