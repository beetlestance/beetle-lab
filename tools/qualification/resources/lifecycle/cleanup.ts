/** Independent owned teardown after bounded/externally interrupted qualification. */
import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { readDeliveryJson } from '../../../delivery/files.js';
import { Docker } from '../../docker.js';
import { cleanupLiveVolumes } from '../../native-application/live-volumes.js';
import { record } from '../values.js';
import { lifecycleOwner, installationOwner, boundedIds } from './ownership.js';
const deadline = performance.now() + 120000;
class CleanupDocker extends Docker {
  override run(args: string[], input?: string): string {
    assert(performance.now() < deadline, 'Cleanup result deadline');
    const value = super.run(args, input);
    assert(performance.now() < deadline, 'Cleanup result deadline');
    return value;
  }
}
function peers(docker: Docker, owner: ReturnType<typeof lifecycleOwner>) {
  const ids = boundedIds(
    docker.run(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${owner.project}`]),
    6,
  );
  for (const id of ids) {
    const rows = docker.json<unknown[]>(['inspect', id]);
    assert.equal(rows.length, 1);
    const row = record(rows[0]);
    assert.equal(row.Id, id);
    const labels = record(record(row.Config).Labels);
    assert.equal(labels['com.docker.compose.project'], owner.project);
    assert.equal(labels['org.opencontainers.image.revision'], owner.revision);
  }
  return ids;
}
async function main() {
  const [output, extra] = process.argv.slice(2);
  assert(output && isAbsolute(output) && !extra);
  const owner = lifecycleOwner(await readDeliveryJson(join(output, 'owner.json')));
  const docker = new CleanupDocker('default');
  const ids = peers(docker, owner);
  let failed = false;
  const attempt = (action: () => void) => {
    try {
      action();
    } catch {
      failed = true;
    }
  };
  if (ids.length) {
    attempt(() => {
      docker.run(['stop', '--time', '5', ...ids]);
    });
    attempt(() => {
      docker.run(['rm', '-f', ...ids]);
    });
  }
  let installation: string | undefined;
  try {
    installation = installationOwner(await readDeliveryJson(join(output, 'installation-owner.json')), owner.project);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed = true;
  }
  if (installation) {
    const id = installation;
    attempt(() => {
      docker.cleanup(id);
    });
    attempt(() => {
      cleanupLiveVolumes({ id, user: '1000:1000', docker });
    });
  }
  const networks = boundedIds(
    docker.run(['network', 'ls', '-q', '--no-trunc', '--filter', `label=com.docker.compose.project=${owner.project}`]),
    3,
  );
  for (const id of networks)
    attempt(() => {
      docker.run(['network', 'rm', id]);
    });
  assert.equal(docker.run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${owner.project}`]), '');
  assert.equal(
    docker.run(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${owner.project}`]),
    '',
  );
  assert(!failed && performance.now() < deadline);
  console.log(JSON.stringify({ cleanupVerified: true }));
}
main().catch(() => {
  console.error('Owned lifecycle cleanup was not verified');
  process.exitCode = 1;
});
