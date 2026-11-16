import {execFileSync} from 'node:child_process';
import {mkdir, writeFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, dirname, basename, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {archiveProducer, ArchiveProducerError} from '../producer.js';
import {nativeFailureRecord} from './native-failure.js';
let phase = 'input';
import {readDeliveryJson, readDeliveryBytes} from '../files.js';
import {architectureIdentity, candidateRoles} from '../identity.js';
import {capturePublishedPlan} from './value.js';
import type {RegistryPlan} from './value.js';
import {object, hash} from './descriptors.js';
import {installationReferences, verifyLoadedImage, verifyNativeOutcome, qualificationRecord, verifyPullProof} from './native-value.js';
function docker(config: string, args: readonly string[]): Buffer {
  return execFileSync('docker', ['--context', 'default', '--config', config, ...args], {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe']});
}
async function nativeOwner(log: string) {
  const bytes = await readDeliveryBytes(log); const lines = bytes.toString('utf8').trim().split('\n');
  if (lines.length > 64) throw Error('Native output line bound');
  const first = object(JSON.parse(lines[0]!));
  if (first.state !== 'started' || typeof first.root !== 'string' || typeof first.project !== 'string'
    || dirname(first.root) !== await realpath(tmpdir()) || !/^beetle-compose-evidence-[A-Za-z0-9]{6}$/.test(basename(first.root))
    || !/^beetle-qual-[a-f0-9]{8}$/.test(first.project)) throw Error('Owned native fixture projection invalid');
  return {root: first.root, project: first.project};
}
async function runNative(plan: RegistryPlan, refs: string[], images: Record<string, string>, config: string, output: string): Promise<void> {
  const log = join(output, 'native-private.log'); let failed = true;
  try {
    await archiveProducer({executable: process.execPath, args: ['--import', 'tsx', 'tools/qualification/native-application/compose/smoke.ts', ...refs],
      destination: log, maximumBytes: 262144});
    const owner = await nativeOwner(log); const arch = architectureIdentity(process.arch === 'x64' ? 'amd64' : process.arch);
    verifyNativeOutcome(await readDeliveryJson(join(owner.root, 'outcome.json')), plan, arch, images); failed = false;
  } catch (error) {
    await retainNativeFailure(log, output); throw error;
  } finally {
    if (failed) {
      // Never claim success/cleanup after a killed controller; still attempt owned cleanup.
      try {
        const owner = await nativeOwner(log);
        await archiveProducer({executable: 'docker', args: ['--context', 'default', '--config', config, 'compose', '--project-name', owner.project,
          '--env-file', join(owner.root, 'compose.env'), '--file', resolve('docker-compose.yml'), '--file', join(owner.root, 'target.json'),
          'down', '--remove-orphans', '--timeout', '3'], destination: join(output, 'emergency-cleanup.log'), maximumBytes: 65536, allowEmptyOutput: true});
      } catch { /* Failure remains unqualified; private evidence stays for recovery. */ }
    }
  }
}
async function retainNativeFailure(log: string, output: string): Promise<void> {
  try {
    const owner = await nativeOwner(log);
    const record = nativeFailureRecord(await readDeliveryJson(join(owner.root, 'outcome.json')));
    await writeFile(join(output, 'native-failure.json'), JSON.stringify(record, null, 2), {flag: 'wx', mode: 0o600});
    console.error(JSON.stringify(record));
  } catch { console.error(JSON.stringify({diagnostic: 'native-outcome-unavailable'})); }
}
function argumentsFor(argv: string[]) {
  const [publication, environment, pull, output, extra] = argv;
  if (!publication || !environment || !pull || !output || extra || ![publication, environment, pull, output].every(isAbsolute)) throw Error('Expected publication, environment, fresh pull proof and new output');
  return {publication, environment, pull, output};
}
async function pullDefault(plan: RegistryPlan, refs: string[], config: string, output: string) {
  const architecture = architectureIdentity(process.arch === 'x64' ? 'amd64' : process.arch); const images: Record<string, string> = {};
  for (const [index, role] of candidateRoles.entries()) {
    await archiveProducer({executable: 'docker', args: ['--context', 'default', '--config', config, 'image', 'pull', '--quiet', refs[index]!],
      destination: join(output, `${role}-pull.log`), maximumBytes: 65536});
    const inspected: unknown = JSON.parse(docker(config, ['image', 'inspect', refs[index]!]).toString('utf8'));
    if (!Array.isArray(inspected) || inspected.length !== 1) throw Error('Pulled native image inspection required');
    images[role] = verifyLoadedImage(inspected[0], plan, role, architecture);
  }
  return images;
}
async function main(): Promise<void> {
  const {publication, environment, pull, output} = argumentsFor(process.argv.slice(2));
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const architecture = architectureIdentity(process.arch === 'x64' ? 'amd64' : process.arch);
  verifyPullProof(await readDeliveryJson(pull), plan, architecture);
  const expected = qualificationRecord(plan, architecture);
  const refs = installationReferences(await readDeliveryBytes(environment), plan);
  const sourceCompose = execFileSync('git', ['show', `${plan.revision}:docker-compose.yml`], {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 262144});
  if (hash(await readDeliveryBytes(resolve('docker-compose.yml'))) !== hash(sourceCompose)) throw Error('Native fixture Compose differs from distributed source');
  await mkdir(output, {mode: 0o700}); const config = join(output, 'empty-docker'); await mkdir(config, {mode: 0o700});
  await writeFile(join(config, 'config.json'), '{}', {flag: 'wx', mode: 0o600}); process.env.DOCKER_CONFIG = config;
  phase = 'anonymous-pull';
  const images = await pullDefault(plan, refs, config, output);
  phase = 'native-execution';
  await runNative(plan, refs, images, config, output);
  phase = 'qualification-record';
  await writeFile(join(output, 'qualification.json'), JSON.stringify(expected, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({architecture, anonymousPull: true, nativeExecution: 'passed', cleanupVerified: true}));
}
main().catch(error => {console.error(JSON.stringify({status: 'failed', phase,
  code: error instanceof ArchiveProducerError ? error.kind : 'installation'})); process.exitCode = 1;});
