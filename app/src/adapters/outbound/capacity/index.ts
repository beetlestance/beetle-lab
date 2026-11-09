import type { CapacitySource, CapacitySourceOptions } from '../../../ports/runtime.js';
import { nativeDisk } from './disk.js';
import { openSource } from './source.js';

/** Pins an existing canonical private backend root; one original sample, no queue.
 * Unknown/failing/cancelled samples return null. Close fences and drains native
 * work and root handles; the installation retains ownership of its shared gateway.
 */
export function openCapacitySource(options: CapacitySourceOptions): Promise<CapacitySource> {
  return openSource(options, nativeDisk, Date.now);
}
