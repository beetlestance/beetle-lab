import { join } from 'node:path';
import { fixture, operation } from './fixtures.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import type { OutputScanRequest } from '../../src/staging/index.js';
import { scope } from '../admission/fixtures.js';
export { operation };
export function outputFixture() {
  const f = fixture();
  return { ...f, async prepared() {
    const e = await f.environment(); const staged = e.prepare(e.create());
    const result = await staged.result; await staged.quiesced;
    if (!result.ok) throw new Error(result.reason);
    const request: OutputScanRequest = { key: scope(e.offer), plan: result.value,
      outputBytes: 1_048_576, minimumFreeBytes: 0 };
    const directory = join(e.rootPath, runtimeName({ ...request.key, installationId: e.configuration.installationId }), 'output');
    return { ...e, request, directory };
  } };
}
