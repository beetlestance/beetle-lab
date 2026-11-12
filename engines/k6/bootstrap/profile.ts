import { K6_LIVE_METRIC_IMAGE_ENV } from '@beetle/contracts/k6-live';
import type { StagedK6Options } from '../wrapper/attempt/index.js';

/** Image packaging is the only path and version authority. */
export function imageOptions(signal: AbortSignal): StagedK6Options {
  const marker = process.env[K6_LIVE_METRIC_IMAGE_ENV];
  if (marker !== undefined && marker !== '1') throw new Error('Unsupported image live metric profile');
  return Object.freeze({ inputRoot: '/beetle/input', secretRoot: '/beetle/secrets', outputRoot: '/beetle/output',
    uid: process.getuid!(), liveMetricMailbox: marker === '1', headerTimeoutMs: 5000, signal,
    installed: Object.freeze({ id: 'k6', version: '2.2.0', configVersion: 1,
      configSchema: 'https://beetle.test/contracts/engines/k6/v1/suite',
      resultSchema: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' }) });
}
