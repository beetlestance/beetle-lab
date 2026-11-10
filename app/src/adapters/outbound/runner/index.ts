import type { LoadedAgentConfiguration, RunnerGateway } from '../../../ports/runner.js';
import { openGateway } from './gateway.js';
import { nativeIo } from './native.js';

/** Installation-owned, bounded Node HTTP gateway. Closing retains original I/O. */
export function createRunnerGateway(loaded: LoadedAgentConfiguration): RunnerGateway {
  return openGateway(loaded, nativeIo);
}

export { startDeliveryRuntime } from './delivery/index.js';
