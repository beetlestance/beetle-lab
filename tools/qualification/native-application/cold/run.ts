import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {capturePublishedPlan} from '../../../delivery/registry/value.js';
import {readDeliveryJson} from '../../../delivery/files.js';
import {verifyLoadedImage} from '../../../delivery/registry/native-value.js';
import {fixture} from '../compose/fixture.js';
import {cleanup} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {seed} from './seed.js';
import {maintenance} from './maintenance.js';
import {historicalViewer} from './viewer.js';
const [publication, output, context = 'default', extra] = process.argv.slice(2);
assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
const plan = capturePublishedPlan(await readDeliveryJson(publication));
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
const references = roles.map(role => `${plan.repository}@${plan.images.find(image => image.role === role)!.index.digest}`);
const f = await fixture([...references, context]);
for (const [index, role] of roles.entries()) {
  const images = f.docker.json<unknown[]>(['image', 'inspect', references[index]!]); assert.equal(images.length, 1);
  verifyLoadedImage(images[0], plan, role, f.architecture as 'amd64' | 'arm64');
}
await mkdir(output, {mode: 0o700}); const owner = randomUUID();
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let phase = 'seed'; let status = 'failed';
const results: Record<string, unknown> = {};
try {
  const seeded = await seed(f, async id => {
    installation = id; await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: id}), {flag: 'wx', mode: 0o600});
  });
  results.seed = seeded; phase = 'cold-stop'; f.compose('stop');
  for (const id of f.ids()) assert.equal(f.docker.json<{State: {Running: boolean}}[]>(['inspect', id])[0]!.State.Running, false);
  phase = 'backup'; const tool = maintenance(f, owner); const archive = join(tool.work, 'archive'); const history = join(tool.work, 'history');
  const limits = {maximumBytes: 134217728, maximumEntries: 2000}; const common = {version: 1 as const, limits, timeoutMs: 45000};
  const sourcePaths = ['data/backend/metadata.sqlite', 'data/agent/journal/journal.sqlite'].map(path => join(f.home, path));
  const sourceHashes = sourcePaths.map(path => tool.digest(path));
  results.backup = tool.cli({...common, command: 'backup', source: join(f.home, 'data'), destination: archive});
  assert.deepEqual(sourcePaths.map(path => tool.digest(path)), sourceHashes); results.sourceMainFilesUnchanged = true;
  phase = 'restore'; const restore = {...common, command: 'restore' as const, archive, destination: history, operationId: randomUUID()};
  const restored = tool.cli(restore); results.restore = restored;
  const metadata = join(history, 'data/metadata.sqlite'); const before = tool.digest(metadata);
  phase = 'historical-viewer'; results.viewer = await historicalViewer(f, owner, history, seeded.run, seeded.artifacts);
  phase = 'completed-resume'; assert.deepEqual(tool.cli({...restore, resume: true}), restored);
  assert.equal(tool.digest(metadata), before); results.metadataUnchanged = true; results.completedResumeUnchanged = true;
  assert.deepEqual(sourcePaths.map(path => tool.digest(path)), sourceHashes);
  status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});
} finally {
  const failures: string[] = [];
  try {f.docker.cleanup(owner);} catch {failures.push('maintenance-viewer');}
  try {await cleanup(f, installation);} catch {failures.push('source');}
  if (!failures.includes('source') && installation) {
    try {cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker});} catch {failures.push('live-volumes');}
  }
  const cleanupVerified = failures.length === 0;
  if (!cleanupVerified) {status = 'failed'; process.exitCode = 1;}
  results.cleanupFailures = failures;
  await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, revision: f.revision,
    architecture: f.architecture, imageIds: f.imageIds, user: '1000:1000', results}, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({status, phase, cleanupVerified}));
}
