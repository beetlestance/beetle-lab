import type {RunnerRetirementGateway} from '../../../ports/runner-retirement.js';
import type {RunnerExportGateway} from '../../../ports/export-runner.js';
import type { LoadedAgentConfiguration } from '../../../ports/runner.js';
import type { RunnerLiveMetricGateway } from '../../../ports/run-live-metrics.js';
import { openGateway } from './gateway.js';
import { nativeIo } from './native.js';

/** Installation-owned, bounded Node HTTP gateway. Closing retains original I/O. */
export function createRunnerGateway(loaded: LoadedAgentConfiguration): RunnerLiveMetricGateway & RunnerExportGateway & RunnerRetirementGateway {
  return openGateway(loaded, nativeIo);
}

export { startDeliveryRuntime } from './delivery/index.js';
export { eventDiscovery as createEventDiscovery } from './delivery/event-discovery.js';
