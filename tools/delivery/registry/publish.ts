import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {readDeliveryJson} from '../files.js';
import {readQualifiedRun} from '../github.js';
import {captureRegistryPlan, composeEnvironment} from './value.js';
import {RegistryTool} from './tool.js';
import {preflightRegistry, publishRegistry} from './remote.js';
import {GithubDelivery, GithubDeliveryError} from './github-api.js';
import {publishSources} from './public-sources.js';
import {publicationCredentials} from './context.js';
let phase = 'input';
async function main(): Promise<void> {
  const [planDirectory, sourceDirectory, output, executable, extra] = process.argv.slice(2);
  if (!planDirectory || !sourceDirectory || !output || !executable || extra
    || ![planDirectory, sourceDirectory, output, executable].every(path => isAbsolute(path) && path.length <= 4096)) throw Error('Expected plan, sources, new output and pinned registry tool absolute paths');
  const plan = captureRegistryPlan(await readDeliveryJson(join(planDirectory, 'publication-plan.json')));
  const credentials = publicationCredentials();
  phase = 'qualified-source'; await readQualifiedRun(plan.sourceRunId, plan.revision);
  await mkdir(output, {mode: 0o700});
  const tool = await RegistryTool.open(executable, join(output, 'private-tool'), credentials);
  const api = new GithubDelivery(output);
  phase = 'registry-preflight'; await preflightRegistry(tool, plan);
  phase = 'public-sources'; await publishSources(api, plan, sourceDirectory, output);
  phase = 'registry-copy-and-readback'; await publishRegistry(tool, plan, join(planDirectory, 'layout'));
  phase = 'installer-record';
  await writeFile(join(output, 'beetle-lab.env'), composeEnvironment(plan), {flag: 'wx', mode: 0o600});
  await writeFile(join(output, 'publication.json'), JSON.stringify({format: 'beetle-published-candidate', version: 1,
    status: 'published', anonymousQualification: 'pending', plan}, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({revision: plan.revision, publishedIndexes: 6, anonymousQualification: 'pending'}));
}
main().catch(error => {console.error(JSON.stringify({status: 'failed', phase,
  code: error instanceof GithubDeliveryError ? 'github' : 'operation', httpStatus: error instanceof GithubDeliveryError ? error.status : null})); process.exitCode = 1;});
