/** Published immutable-image entrypoint; execution is shared with source qualification. */
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { capturePublishedPlan } from '../../../delivery/registry/value.js';
import { readDeliveryJson } from '../../../delivery/files.js';
import { verifyLoadedImage } from '../../../delivery/registry/native-value.js';
import { fixture } from '../../native-application/compose/fixture.js';
import { configuration, qualificationCases } from './configuration.js';
import { executeLifecycle } from './execution.js';
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
function argumentsFor(argv: string[]) {
  const [publication, output, context = 'default', mode = 'crashes', extra] = argv;
  assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
  return { publication, output, context, mode };
}
async function main() {
  const { publication, output, context, mode } = argumentsFor(process.argv.slice(2));
  qualificationCases(mode);
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const references = roles.map(
    (role) => `${plan.repository}@${plan.images.find((image) => image.role === role)!.index.digest}`,
  );
  const config = await configuration();
  const f = await fixture([...references, context], 128);
  for (const [index, role] of roles.entries()) {
    const images = f.docker.json<unknown[]>(['image', 'inspect', references[index]!]);
    assert.equal(images.length, 1);
    verifyLoadedImage(images[0], plan, role, f.architecture as 'amd64' | 'arm64');
  }
  await executeLifecycle({ f, config, output, mode });
}
main().catch(() => {
  console.error('Packaged active recovery did not qualify');
  process.exitCode = 1;
});
