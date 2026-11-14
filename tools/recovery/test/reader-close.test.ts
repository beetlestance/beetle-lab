import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('retains failed-close read custody and never retries an uncertain native close', async () => {
  const result = await promisify(execFile)(process.execPath, ['--import','tsx',fileURLToPath(new URL('./reader-close.child.ts', import.meta.url))], {timeout: 10000, maxBuffer: 16384});
  expect(JSON.parse(result.stdout)).toEqual({closes: 1, settled: false, fenced: true}); expect(result.stderr).not.toContain('PRIVATE_CLOSE_CANARY');
});
