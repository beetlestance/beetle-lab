/** Fixed stopped synthetic fixture only; opens no writer, service or migration. */
import assert from 'node:assert/strict';
import { join, isAbsolute } from 'node:path';
import { realpath, writeFile } from 'node:fs/promises';
import { validateApi } from '@beetle/contracts/api';
import { readDeliveryJson } from '../../../delivery/files.js';
import { Docker } from '../../docker.js';
import { coldOwner } from '../cold/ownership.js';
import { installationOwner } from '../../resources/lifecycle/ownership.js';
import { record } from '../../resources/values.js';
import { readLongReport } from '../soak/report.js';
import { coldDatabase } from './database.js';
import { backend } from './backend.js';
import { agent } from './agent.js';
import { reconcile } from './reconcile.js';
const [evidence, output, context = 'default', extra] = process.argv.slice(2);
assert(evidence && output && isAbsolute(evidence) && isAbsolute(output) && !extra);
const owner = coldOwner(await readDeliveryJson(join(evidence, 'owner.json')));
assert.equal(await realpath(owner.root), owner.root);
const installation = installationOwner(
  await readDeliveryJson(join(evidence, 'installation-owner.json')),
  owner.project,
);
const source = record(await readLongReport(join(evidence, 'outcome-private.json')));
assert.equal(source.status, 'passed');
assert.equal(source.cleanupVerified, true);
assert.equal(source.sourceRevision, owner.revision);
const trials = record(source.results).trials;
assert(Array.isArray(trials) && trials.length === 4);
const runs = trials.map((item) => {
  const checked = validateApi('Run', record(record(item).loaded).run);
  assert(checked.ok);
  assert.equal(checked.value.state, 'finished');
  assert.equal(checked.value.outcome, 'passed');
  return checked.value;
});
assert.equal(new Set(runs.map((run) => run.id)).size, 4);
assert.equal(new Set(runs.map((run) => run.activeAttemptId)).size, 4);
const docker = new Docker(context, 2);
assert.equal(docker.run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${owner.project}`]), '');
assert.equal(docker.ownedIds(installation).length, 0);
const data = join(owner.root, 'home/data');
const backendState = await coldDatabase(join(data, 'backend/metadata.sqlite'), (db) => backend(db, runs));
const agentState = await coldDatabase(join(data, 'agent/journal/journal.sqlite'), (db) =>
  agent(db, runs, installation),
);
const files = await reconcile(data, runs, backendState.result, agentState.result);
const result = {
  status: 'passed',
  scope: 'four-run-cold-accounting',
  sourceRevision: owner.revision,
  architecture: source.architecture,
  harnessNode: process.version,
  backend: backendState.result.debt,
  agent: {
    currentRetainedOutputBytes: agentState.result.currentRetainedOutputBytes,
    currentRetainedStagingBytes: agentState.result.currentRetainedStagingBytes,
    journalMetadataBytes: agentState.result.journalMetadataBytes,
    executionCharged: 0,
  },
  files,
  databases: { backend: backendState.database, agent: agentState.database },
  limits: [
    'Logical debt differs from actual file length and host freed blocks',
    'No active-write, retention-delete or general workload accounting proof',
    'No RSS plateau or telemetry-cost conclusion',
  ],
};
await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(
  JSON.stringify({
    status: result.status,
    backendChargedBytes: result.backend.currentChargedBytes,
    publishedFiles: files.publishedFiles,
    inspectedEntries: files.inspectedEntries,
  }),
);
