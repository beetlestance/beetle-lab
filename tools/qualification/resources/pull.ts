import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {archiveProducer} from '../../delivery/producer.js';
import {readDeliveryJson} from '../../delivery/files.js';
import {capturePublishedPlan} from '../../delivery/registry/value.js';
import {verifyLoadedImage} from '../../delivery/registry/native-value.js';
import {Docker} from '../docker.js';
import {qualificationArchitecture} from './values.js';
async function main() {
  const [publication, output, extra] = process.argv.slice(2);
  assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
  assert.equal(process.platform, 'linux');
  const architecture = qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE);
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const engine = plan.images.find(image => image.role === 'engine')!; const reference = `${plan.repository}@${engine.index.digest}`;
  await mkdir(output, {mode: 0o700}); const config = join(output, 'docker'); await mkdir(config, {mode: 0o700});
  await writeFile(join(config, 'config.json'), '{"auths":{}}', {flag: 'wx', mode: 0o600});
  await archiveProducer({executable: 'docker', args: ['--config', config, '--host', 'unix:///var/run/docker.sock',
    'pull', '--platform', `linux/${architecture}`, reference], destination: join(output, 'pull-private.log'),
  maximumBytes: 65536, timeoutMs: 120000});
  const docker = new Docker('default'); const images = docker.json<unknown[]>(['image', 'inspect', reference]);
  assert.equal(images.length, 1); verifyLoadedImage(images[0], plan, 'engine', architecture);
  console.log(JSON.stringify({status: 'verified', architecture, reference}));
}
main().catch(() => {console.error('Anonymous native engine pull did not qualify'); process.exitCode = 1;});
