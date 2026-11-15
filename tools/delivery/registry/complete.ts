import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {readDeliveryJson, readDeliveryBytes, deliveryDigest} from '../files.js';
import {archiveProducer} from '../producer.js';
import {capturePublishedPlan, composeEnvironment, releaseTag} from './value.js';
import {verifyQualification} from './native-value.js';
import {publicationCredentials} from './context.js';
import {RegistryTool} from './tool.js';
import {preflightRegistry, verifyPublishedRegistry} from './remote.js';
import {GithubDelivery} from './github-api.js';
import {ensureRelease, ensureAsset, publishRelease} from './releases.js';
function argumentsFor(argv: string[]) {
  const [publication, environment, amd64, arm64, output, executable, extra] = argv;
  if (!publication || !environment || !amd64 || !arm64 || !output || !executable || extra
    || ![publication, environment, amd64, arm64, output, executable].every(isAbsolute)) throw Error('Expected publication, environment, native proofs, new output and pinned tool');
  return {publication, environment, amd64, arm64, output, executable};
}
async function main(): Promise<void> {
  const args = argumentsFor(process.argv.slice(2)); publicationCredentials();
  const plan = capturePublishedPlan(await readDeliveryJson(args.publication));
  const amd64 = await readDeliveryJson(args.amd64); const arm64 = await readDeliveryJson(args.arm64);
  verifyQualification(amd64, plan, 'amd64'); verifyQualification(arm64, plan, 'arm64');
  const environment = await readDeliveryBytes(args.environment);
  if (environment.toString('utf8') !== composeEnvironment(plan)) throw Error('Qualified installer environment mismatch');
  await mkdir(args.output, {mode: 0o700});
  const tool = await RegistryTool.open(args.executable, join(args.output, 'private-tool'));
  await preflightRegistry(tool, plan);
  await verifyPublishedRegistry(tool, plan);
  const api = new GithubDelivery(args.output);
  const release = await ensureRelease(api, releaseTag(plan), plan.revision,
    `Qualified rewrite candidate ${plan.revision}; source CI ${plan.sourceRunId}.\n\n` +
    'Anonymous image pulls and packaged execution passed on Linux AMD64 and ARM64. The UI is provisional.\n\n' +
    'Download docker-compose.yml and beetle-lab.env into one directory, then run:\n\n' +
    '```sh\ndocker compose --env-file beetle-lab.env up -d\n```\n\nOpen http://127.0.0.1:4567.\n\n' +
    `Sources and notices: ${plan.sources.url}\n`);
  const compose = execFileSync('git', ['show', `${plan.revision}:docker-compose.yml`], {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 262144});
  const files: Readonly<Record<string, string | Buffer>> = {'beetle-lab.env': environment, 'docker-compose.yml': compose,
    'publication.json': JSON.stringify({format: 'beetle-published-candidate', version: 1, status: 'published', anonymousQualification: 'passed', plan}, null, 2),
    'anonymous-qualification.json': JSON.stringify({amd64, arm64}, null, 2)};
  for (const [name, contents] of Object.entries(files)) {
    const file = join(args.output, name); await writeFile(file, contents, {flag: 'wx', mode: 0o600});
    await ensureAsset(api, release, file, await deliveryDigest(file, 262144));
  }
  await publishRelease(api, release);
  for (const name of ['beetle-lab.env', 'docker-compose.yml']) {
    const file = join(args.output, name); const expected = await deliveryDigest(file, 262144); const readback = file + '.anonymous';
    await archiveProducer({executable: 'curl', args: ['--disable', '--silent', '--show-error', '--fail', '--location', '--proto', '=https',
      '--proto-redir', '=https', '--max-time', '115', `https://github.com/beetlestance/beetle-lab/releases/download/${release.tag}/${name}`],
      destination: readback, maximumBytes: expected.bytes});
    const actual = await deliveryDigest(readback, expected.bytes);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw Error('Public installer asset changed');
  }
  await writeFile(join(args.output, 'delivery.json'), JSON.stringify({format: 'beetle-complete-delivery', version: 1, status: 'passed',
    revision: plan.revision, sourceRunId: plan.sourceRunId, native: ['amd64', 'arm64'],
    url: `https://github.com/beetlestance/beetle-lab/releases/tag/${release.tag}`}, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({status: 'passed', native: ['amd64', 'arm64'], anonymousInstallerReadback: true}));
}
main().catch(() => {console.error('Candidate final delivery failed; public availability or native qualification is incomplete.'); process.exitCode = 1;});
