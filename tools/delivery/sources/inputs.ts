import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {candidateRoles} from '../identity.js';
import {captureBundle} from '../bundle.js';
import {readDeliveryJson} from '../files.js';
import {captureSourceCatalog, sourceRecord} from './catalog.js';
import {verifyRuntimeSource, verifySourceCoverage, verifyK6Module} from './coverage.js';
import {npmSources} from './npm.js';
import {fileURLToPath} from 'node:url';
export function sourceTreeFile(revision: string, name: 'package-lock.json' | 'engines/k6/Dockerfile' | 'LICENSE'): Buffer {
  return execFileSync('git', ['show', `${revision}:${name}`], {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 ** 2,
    stdio: ['ignore', 'pipe', 'pipe']});
}
function selectedCandidates(input: unknown) {
  const staged = sourceRecord(input);
  if (staged.format !== 'beetle-staged-delivery' || staged.version !== 1 || !Array.isArray(staged.candidates)
    || staged.candidates.length !== 2) throw Error('Complete staged delivery required');
  const candidates = staged.candidates.map(captureBundle);
  const revision = candidates[0]!.revision;
  if (new Set(candidates.map(row => row.architecture)).size !== 2 || candidates.some(row => row.revision !== revision)) throw Error('Mixed staged source revisions');
  return {candidates, revision};
}
export async function sourceInputs(staging: string) {
  const catalog = captureSourceCatalog(await readDeliveryJson(fileURLToPath(new URL('./catalog.json', import.meta.url))));
  const {candidates, revision} = selectedCandidates(await readDeliveryJson(join(staging, 'staged.json')));
  const coverage = [];
  for (const bundle of candidates) for (const role of candidateRoles) {
    const directory = join(staging, bundle.architecture, 'supply-chain');
    const scan = await readDeliveryJson(join(directory, `${role}.scan.json`));
    verifyRuntimeSource(await readDeliveryJson(join(directory, `${role}.identity.json`)), role, catalog);
    const origins = verifySourceCoverage(scan, catalog);
    if (role === 'engine' || role === 'export') verifyK6Module(scan, catalog);
    coverage.push({architecture: bundle.architecture, role, origins});
  }
  if (!sourceTreeFile(revision, 'engines/k6/Dockerfile').toString('utf8').includes(catalog.k6Binary.baseImage)) throw Error('Pinned k6 base differs from observed provenance');
  const npm = npmSources(JSON.parse(sourceTreeFile(revision, 'package-lock.json').toString('utf8')) as unknown);
  return {catalog, candidates, revision, coverage, npm};
}
