import { captureOptions } from './options.js';
import { Publisher } from './publisher.js';
import type { LiveMetricPublisher, LiveMetricPublisherOptions } from './types.js';
export { LiveMetricPublisherError } from './types.js';
export type * from './types.js';
export function createLiveMetricPublisher(options: LiveMetricPublisherOptions): LiveMetricPublisher {
  return new Publisher(captureOptions(options));
}
