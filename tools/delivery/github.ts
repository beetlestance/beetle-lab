import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {captureQualifiedRun} from './trust.js';
import {revisionIdentity} from './identity.js';
const execute = promisify(execFile);
const repository = 'repos/beetlestance/beetle-lab';
type Api = (path: string) => Promise<unknown>;
async function github(path: string): Promise<unknown> {
  let stdout: string;
  try {
    ({stdout} = await execute('gh', ['api', '--hostname', 'github.com', path], {
      timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 ** 2, encoding: 'utf8', windowsHide: true}));
  } catch { throw Error('Qualified delivery GitHub API request failed'); }
  try { return JSON.parse(stdout) as unknown; }
  catch { throw Error('Qualified delivery GitHub API JSON invalid'); }
}
/** No arbitrary URL, credential readback, registry permission or artifact-name download.
 * The CLI owns authenticated GitHub access; the caller receives only validated immutable IDs. */
export async function readRunMetadata(runId: number, revision: string, api: Api = github) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw Error('Invalid delivery run ID');
  revisionIdentity(revision);
  const results = await Promise.allSettled([
    api(`${repository}/actions/workflows/ci.yml`), api(`${repository}/actions/runs/${runId}`),
    api(`${repository}/actions/runs/${runId}/jobs?per_page=100&filter=all`),
    api(`${repository}/actions/runs/${runId}/artifacts?per_page=100`)]);
  // Join every issued original before exposing either an error or a selected run.
  const values = results.map(result => {
    if (result.status === 'rejected') throw Error('Qualified delivery GitHub metadata unavailable');
    return result.value;
  });
  const workflow = values[0];
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw Error('Delivery workflow identity required');
  const identity = workflow as Record<string, unknown>;
  if (identity.path !== '.github/workflows/ci.yml' || identity.state !== 'active'
    || typeof identity.id !== 'number') throw Error('Delivery workflow identity mismatch');
  return {run: values[1], jobs: values[2], artifacts: values[3], workflowId: identity.id};
}
export async function readQualifiedRun(runId: number, revision: string, api: Api = github) {
  const metadata = await readRunMetadata(runId, revision, api);
  return captureQualifiedRun(metadata, {runId, revision, workflowId: metadata.workflowId});
}
