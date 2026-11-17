/** Independent cleanup of the exact synthetic project and its two image aliases. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { readDeliveryJson } from '../../../delivery/files.js';
import { Docker } from '../../docker.js';
import { coldOwner } from '../cold/ownership.js';
import { record } from '../../resources/values.js';
const [output, context = 'default', extra] = process.argv.slice(2);
assert(output && isAbsolute(output) && !extra);
const owner = coldOwner(await readDeliveryJson(join(output, 'owner.json')));
execFileSync(
  process.execPath,
  ['--import', 'tsx', resolve('tools/qualification/native-application/cold/cleanup.ts'), output, context],
  { timeout: 120000, maxBuffer: 65536, stdio: 'pipe' },
);
const docker = new Docker(context, 2);
let removed = 0;
let overlay: Record<string, unknown> | undefined;
try {
  overlay = record(await readDeliveryJson(join(output, 'overlay-owner.json')));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
if (overlay) {
  const instance = owner.project.slice('beetle-'.length);
  assert(/^qual-[a-f0-9]{8}$/.test(instance));
  assert.equal(overlay.project, owner.project);
  assert.equal(overlay.tag, 'beetle-qualification-telemetry:' + instance);
  assert.equal(overlay.base, 'beetle-qualification-base:' + instance);
  assert(typeof overlay.baseImageId === 'string' && /^sha256:[a-f0-9]{64}$/.test(overlay.baseImageId));
  for (const reference of [overlay.tag, overlay.base]) {
    assert(typeof reference === 'string');
    if (!docker.run(['image', 'ls', '-q', '--filter', 'reference=' + reference])) continue;
    const images = docker.json<{ Id: string; Config: { Labels: Record<string, string> } }[]>([
      'image',
      'inspect',
      reference,
    ]);
    assert.equal(images.length, 1);
    if (reference === overlay.base) assert.equal(images[0]!.Id, overlay.baseImageId);
    else assert.equal(images[0]!.Config.Labels['dev.beetle.qualification'], owner.project);
    docker.run(['image', 'rm', reference]);
    assert.equal(docker.run(['image', 'ls', '-q', '--filter', 'reference=' + reference]), '');
    removed++;
  }
}
console.log(JSON.stringify({ cleanupVerified: true, imageAliasesRemoved: removed }));
