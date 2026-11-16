import assert from 'node:assert/strict';
import {isAbsolute} from 'node:path';
import {capturePublishedPlan} from '../../../delivery/registry/value.js';
import {readDeliveryJson} from '../../../delivery/files.js';
import {verifyLoadedImage} from '../../../delivery/registry/native-value.js';
import {fixture} from '../compose/fixture.js';
import {executeCold} from './execute.js';
const [publication, output, context = 'default', extra] = process.argv.slice(2);
assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
const plan = capturePublishedPlan(await readDeliveryJson(publication));
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
const references = roles.map(role => `${plan.repository}@${plan.images.find(image => image.role === role)!.index.digest}`);
const f = await fixture([...references, context]);
for (const [index, role] of roles.entries()) {
  const images = f.docker.json<unknown[]>(['image', 'inspect', references[index]!]); assert.equal(images.length, 1);
  verifyLoadedImage(images[0], plan, role, f.architecture as 'amd64' | 'arm64');
}
await executeCold({f, output});
