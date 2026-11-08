import type { StagedK6Options } from '../wrapper/attempt/index.js';

/** Image packaging is the only path and version authority. */
export function imageOptions(signal: AbortSignal): StagedK6Options {
  return Object.freeze({ inputRoot: '/beetle/input', secretRoot: '/beetle/secrets', outputRoot: '/beetle/output',
    uid: process.getuid!(), headerTimeoutMs: 5000, signal,
    installed: Object.freeze({ id: 'k6', version: '2.2.0', configVersion: 1,
      configSchema: 'https://beetle.test/contracts/engines/k6/v1/suite',
      resultSchema: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' }) });
}
