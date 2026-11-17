/** Independent CI teardown if the bounded controller is externally interrupted. */
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { readDeliveryJson } from '../../delivery/files.js';
import { Docker } from '../docker.js';
import { record } from './values.js';
async function main() {
  const [path, extra] = process.argv.slice(2);
  assert(path && isAbsolute(path) && !extra);
  const saved = record(await readDeliveryJson(path));
  assert(
    typeof saved.owner === 'string' &&
      /^beetle-resource-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(saved.owner),
  );
  const docker = new Docker('default');
  docker.cleanup(saved.owner);
  console.log(JSON.stringify({ cleanupVerified: true }));
}
main().catch(() => {
  console.error('Owned resource cleanup was not verified');
  process.exitCode = 1;
});
