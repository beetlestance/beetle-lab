import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { archiveProducer } from '../../delivery/producer.js';
import { readDeliveryJson } from '../../delivery/files.js';
import { capturePublishedPlan } from '../../delivery/registry/value.js';
import { verifyLoadedImage } from '../../delivery/registry/native-value.js';
import { Docker } from '../docker.js';
import { qualificationRoles } from './published-value.js';
import { qualificationArchitecture } from './values.js';
function argumentsFor(argv: string[]) {
  const [publication, output, mode = 'engine', extra] = argv;
  assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
  return { publication, output, roles: qualificationRoles(mode) };
}
async function main() {
  const { publication, output, roles } = argumentsFor(process.argv.slice(2));
  assert.equal(process.platform, 'linux');
  const architecture = qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE);
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  await mkdir(output, { mode: 0o700 });
  const config = join(output, 'docker');
  await mkdir(config, { mode: 0o700 });
  await writeFile(join(config, 'config.json'), '{"auths":{}}', { flag: 'wx', mode: 0o600 });
  const docker = new Docker('default');
  for (const role of roles) {
    const image = plan.images.find((value) => value.role === role)!;
    const reference = `${plan.repository}@${image.index.digest}`;
    await archiveProducer({
      executable: 'env',
      args: [
        '-u',
        'DOCKER_HOST',
        '-u',
        'DOCKER_CONTEXT',
        'docker',
        '--config',
        config,
        '--host',
        'unix:///var/run/docker.sock',
        'pull',
        '--platform',
        `linux/${architecture}`,
        reference,
      ],
      destination: join(output, `${role}-pull-private.log`),
      maximumBytes: 65536,
      timeoutMs: 120000,
    });
    const images = docker.json<unknown[]>(['image', 'inspect', reference]);
    assert.equal(images.length, 1);
    verifyLoadedImage(images[0], plan, role, architecture);
    console.log(JSON.stringify({ status: 'verified', architecture, role, reference }));
  }
}
main().catch(() => {
  console.error('Anonymous native engine pull did not qualify');
  process.exitCode = 1;
});
