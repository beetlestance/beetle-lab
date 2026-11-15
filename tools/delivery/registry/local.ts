import {mkdir, readFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {archiveProducer} from '../producer.js';
import {readDeliveryJson} from '../files.js';
import {readQualifiedRun} from '../github.js';
import {downloadQualifiedArtifact} from '../download.js';
import type {QualifiedArtifact} from '../trust.js';
import {captureRegistryPlan, capturePublishedPlan} from './value.js';
import {GithubDelivery} from './github-api.js';
import {publishSources} from './public-sources.js';
import {readDeliveryRun} from './delivery-run.js';
import {completeDelivery} from './complete.js';
async function unpack(artifact: QualifiedArtifact, directory: string, expected: readonly string[]) {
  await mkdir(directory, {mode: 0o700});
  const zip = await downloadQualifiedArtifact(artifact, directory); const listing = join(directory, 'members.txt');
  await archiveProducer({executable: 'unzip', args: ['-Z1', zip], destination: listing, maximumBytes: 4096});
  const names = (await readFile(listing, 'utf8')).trimEnd().split('\n');
  if (names.length !== expected.length || new Set(names).size !== names.length || names.some(name => !expected.includes(name))) throw Error('Unexpected local delivery ZIP member');
  for (const name of expected) await archiveProducer({executable: 'unzip', args: ['-p', zip, name], destination: join(directory, name), maximumBytes: 262144});
}
function completeArguments(rest: string[]) {
  const [run, revision, executable, extra] = rest;
  if (!run || !/^[1-9][0-9]*$/.test(run) || !revision || !executable || !isAbsolute(executable) || extra) throw Error('Expected complete PLAN OUTPUT RUN_ID DELIVERY_SHA REGCTL');
  return {run: Number(run), revision, executable};
}
async function finishLocal(plan: ReturnType<typeof captureRegistryPlan>, output: string, rest: string[]) {
  const {run, revision, executable} = completeArguments(rest);
  const artifacts = await readDeliveryRun(run, revision, plan);
  await mkdir(output, {mode: 0o700});
  const published = join(output, 'published'); const amd64 = join(output, 'amd64'); const arm64 = join(output, 'arm64');
  await unpack(artifacts[0]!, published, ['publication.json', 'beetle-lab.env']);
  await unpack(artifacts[1]!, amd64, ['qualification.json']); await unpack(artifacts[2]!, arm64, ['qualification.json']);
  const actual = capturePublishedPlan(await readDeliveryJson(join(published, 'publication.json')));
  if (JSON.stringify(actual) !== JSON.stringify(plan)) throw Error('Trusted CI publication differs from expected plan');
  await completeDelivery({publication: join(published, 'publication.json'), environment: join(published, 'beetle-lab.env'),
    amd64: join(amd64, 'qualification.json'), arm64: join(arm64, 'qualification.json'), output: join(output, 'release'), executable});
}
async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('Local release requires the existing local GitHub session');
  const [mode, planFile, output, ...rest] = process.argv.slice(2);
  if (!planFile || !output || ![planFile, output].every(isAbsolute)) throw Error('Expected mode, absolute plan and new output');
  const plan = captureRegistryPlan(await readDeliveryJson(planFile));
  await readQualifiedRun(plan.sourceRunId, plan.revision);
  if (mode === 'complete') { await finishLocal(plan, output, rest); return; }
  if (mode !== 'sources' || rest.length !== 1 || !isAbsolute(rest[0]!)) throw Error('Expected sources PLAN OUTPUT SOURCES');
  await mkdir(output, {mode: 0o700});
  await publishSources(new GithubDelivery(output), plan, rest[0]!, output);
  console.log(JSON.stringify({sourceRelease: 'public', anonymousReadback: 'passed'}));
}
main().catch(() => {console.error('Local release failed; source, native or public availability proof is incomplete.'); process.exitCode = 1;});
