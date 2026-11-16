import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const roots: string[] = [];
const revision = 'a'.repeat(40);
const imageId = `sha256:${'b'.repeat(64)}`;
const script = fileURLToPath(new URL('../../scripts/rewrite-supply-chain.sh', import.meta.url));
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture(mode: 'pass' | 'audit' | 'image' | 'identity' | 'gate') {
  const root = await mkdtemp(join(tmpdir(), 'beetle-supply-test-')); roots.push(root);
  const bin = join(root, 'bin'); await mkdir(bin);
  const npm = '#!/bin/sh\nprintf "{}\\n"\nif [ "$1" = audit ] && [ "$MODE" = audit ]; then exit 1; fi\n';
  const docker = `#!/bin/sh
if [ "$3" = --format ]; then
  arch=arm64; if [ "$MODE" = identity ]; then arch=amd64; fi
  printf '%s %s linux %s\\n' '${imageId}' '${revision}' "$arch"
else printf '[{"Id":"${imageId}"}]\\n'; fi
`;
  const scanner = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = --version ]; then printf 'Version: synthetic\\n'; exit 0; fi
gate=0; case "$*" in *"--exit-code 1"*) gate=1 ;; esac
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; printf '{}\\n' > "$1"; fi
  shift
done
if [ "$MODE" = image ]; then
  # An exit from a gate is preserved; scanning errors must also fail closed.
  exit 1
fi
if [ "$MODE" = gate ] && [ "$gate" = 1 ]; then exit 1; fi
`;
  for (const [name, text] of Object.entries({npm, docker, scanner})) await writeFile(join(bin, name), text, {mode: 0o700});
  const calls = join(root, 'calls'); const output = join(root, 'reports');
  const run = () => spawnSync('bash', [script, revision, 'arm64', join(bin, 'scanner'), output], {
    env: {...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, MODE: mode, CALLS: calls},
    // Twelve scans plus conversions/identity calls start separate mock shells.
    // This bounds the test harness, not a product operation or scanner deadline.
    encoding: 'utf8', timeout: 8000, maxBuffer: 65536,
  });
  return {run, output, calls};
}
it('scans immutable image IDs and emits all six SBOM and identity reports', async () => {
  const f = await fixture('pass'); const result = f.run(); expect(result.status, result.stderr).toBe(0);
  const calls = (await readFile(f.calls, 'utf8')).split('\n');
  const scans = calls.filter(line => line.startsWith('image ')); expect(scans).toHaveLength(12);
  expect(scans.filter(line => line.includes('--scanners vuln '))).toHaveLength(6);
  expect(scans.filter(line => line.includes('--scanners license '))).toHaveLength(6);
  for (const call of scans) {expect(call).toContain('--image-src docker'); expect(call.endsWith(imageId)).toBe(true);}
  for (const role of ['frontend', 'backend', 'agent', 'installer', 'engine', 'export']) {
    expect(await readFile(join(f.output, `${role}.cdx.json`), 'utf8')).toContain('{}');
    expect(await readFile(join(f.output, `${role}.identity.json`), 'utf8')).toContain(imageId);
  }
});
it('retains a dependency audit failure while still inventorying every image', async () => {
  const f = await fixture('audit'); expect(f.run().status).toBe(1);
  expect((await readFile(f.calls, 'utf8')).split('\n').filter(line => line.startsWith('image '))).toHaveLength(12);
});
it('fails closed on scanner error and does not fabricate an SBOM', async () => {
  const f = await fixture('image'); expect(f.run().status).toBe(1);
  await expect(readFile(join(f.output, 'frontend.cdx.json'))).rejects.toThrow();
});
it('retains high-severity gate failure while collecting all six image inventories', async () => {
  const f = await fixture('gate'); expect(f.run().status).toBe(1);
  expect((await readFile(f.calls, 'utf8')).split('\n').filter(line => line.startsWith('image '))).toHaveLength(12);
  expect(await readFile(join(f.output, 'export.cdx.json'), 'utf8')).toContain('{}');
});
it('refuses a wrong-architecture image before scanning it', async () => {
  const f = await fixture('identity'); expect(f.run().status).toBe(1);
  expect(await readFile(f.calls, 'utf8')).not.toContain('image ');
});
