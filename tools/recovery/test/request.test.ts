import { expect, it } from 'vitest';
import { captureRequest } from '../src/request.js';
const request = {version: 1, command: 'backup', source: '/private/source', destination: '/private/backup',
  limits: {maximumBytes: 8388608, maximumEntries: 1000}, timeoutMs: 10000};
it('captures explicit bounded maintenance requests and rejects implicit operations/unknown fields', () => {
  expect(captureRequest(request)).toEqual(request);
  for (const changed of [{...request, command: 'reset'}, {...request, overwrite: true}, {...request, source: '../relative'},
    {...request, source: '/private/../alias'}, {...request, source: '/private/\u0000'}, {...request, timeoutMs: 0},
    {...request, limits: {...request.limits, maximumEntries: 100001}}, {...request, limits: {...request.limits, maximumBytes: Number.MAX_VALUE}},
    {...request, limits: {...request.limits, ignored: true}}]) expect(() => captureRequest(changed)).toThrow();
});
