import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'tsup';
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-failure-exit-'));
  for (const owner of ['app', 'agent'])
    await build({
      entry: { [owner]: `${owner}/src/bootstrap/storage-failure.ts` },
      outDir: root,
      format: ['esm'],
      platform: 'node',
      target: 'node24',
      bundle: true,
      silent: true,
    });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function child(owner: string, mode: string) {
  const source = String.raw`import {createStorageFailureExit} from ${JSON.stringify('file://' + join(root, owner + '.js'))};
    setInterval(()=>{},1000);
    const fail=createStorageFailureExit(async()=>{
      process.stdout.write('close-start\n');
      if(${JSON.stringify(mode)}==='hang')await new Promise(()=>{});
      if(${JSON.stringify(mode)}==='reject')throw Error('PRIVATE-CANARY');
      await new Promise(resolve=>setTimeout(resolve,30));process.stdout.write('close-end\n');
    });fail(Error('PRIVATE-CANARY'));fail(Error('SECOND-CANARY'));`;
  const proc = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (bytes) => {
    stdout += String(bytes);
  });
  proc.stderr.on('data', (bytes) => {
    stderr += String(bytes);
  });
  const deadline = setTimeout(() => proc.kill('SIGKILL'), 14000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      proc.once('error', reject);
      proc.once('exit', resolve);
    });
    return { code, stdout, stderr, elapsed: performance.now() - started };
  } finally {
    clearTimeout(deadline);
    proc.kill('SIGKILL');
  }
}
for (const owner of ['app', 'agent']) {
  it.each(['resolve', 'reject', 'hang'])(
    `${owner}: exits unsuccessfully after original cleanup %s`,
    async (mode) => {
      const result = await child(owner, mode);
      expect(result.code).toBe(1);
      expect(result.stdout.match(/close-start/g), result.stderr).toHaveLength(1);
      expect(result.stderr.match(/"event":"storage_failed"/g)).toHaveLength(1);
      expect(result.stderr).not.toContain('CANARY');
      if (mode === 'hang') {
        expect(result.elapsed).toBeGreaterThanOrEqual(9900);
        expect(result.elapsed).toBeLessThan(13500);
        expect(result.stderr).toContain('shutdown_deadline');
        expect(result.stdout).not.toContain('close-end');
      } else if (mode === 'resolve') expect(result.stdout).toContain('close-end');
      else expect(result.stderr).toContain('shutdown_failed');
    },
    15000,
  );
}
