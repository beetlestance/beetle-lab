import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDeliveryJson } from '../../../delivery/files.js';
import { Docker } from '../../docker.js';
import { coldOwner } from '../cold/ownership.js';
import { record } from '../../resources/values.js';
import { volumeOptions } from './fixture.js';
export function ownedVolume(input: unknown, owner: ReturnType<typeof coldOwner>) {
  const row = record(input);
  assert.equal(row.Name, `${owner.project}-disk`);
  assert.equal(row.Driver, 'local');
  const labels = record(row.Labels);
  assert.equal(labels['dev.beetle.qualification'], owner.owner);
  assert.equal(labels['com.docker.compose.project'], owner.project);
  assert.deepEqual(row.Options, { type: 'tmpfs', device: 'tmpfs', o: volumeOptions });
  return row.Name;
}
export function removeOwned(docker: Docker, owner: ReturnType<typeof coldOwner>) {
  const volume = `${owner.project}-disk`;
  const present = docker.run(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]);
  if (present) {
    assert.equal(present, volume);
    const rows = docker.json<unknown[]>(['volume', 'inspect', volume]);
    assert.equal(rows.length, 1);
    ownedVolume(rows[0], owner);
  }
  const ids = docker.ownedIds(owner.owner);
  for (const id of ids) {
    const rows = docker.json<unknown[]>(['inspect', id]);
    assert.equal(rows.length, 1);
    const row = record(rows[0]);
    assert.equal(row.Id, id);
    const labels = record(record(row.Config).Labels);
    assert.equal(labels['dev.beetle.qualification'], owner.owner);
    assert.equal(labels['org.opencontainers.image.revision'], owner.revision);
  }
  docker.cleanup(owner.owner);
  if (present) docker.run(['volume', 'rm', volume]);
  assert.equal(docker.run(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]), '');
  assert.equal(docker.ownedIds(owner.owner).length, 0);
}
async function main() {
  const [output, context = 'default', extra] = process.argv.slice(2);
  assert(output && isAbsolute(output) && !extra);
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context));
  const deadline = performance.now() + 120000;
  class BoundedDocker extends Docker {
    override run(args: string[], input?: string) {
      assert(performance.now() < deadline);
      const result = super.run(args, input);
      assert(performance.now() < deadline);
      return result;
    }
  }
  const owner = coldOwner(await readDeliveryJson(join(output, 'owner.json')));
  removeOwned(new BoundedDocker(context), owner);
  assert(performance.now() < deadline);
  console.log(JSON.stringify({ cleanupVerified: true }));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
