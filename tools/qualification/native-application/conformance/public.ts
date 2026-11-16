/** Upload only closed facts; malformed/missing/failed cases cannot become passes. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {readDeliveryJson} from '../../../delivery/files.js';
import {readLongReport} from '../soak/report.js';
import {sourceCases} from './cases.js';
import {publicCase} from './outcome.js';
import {publicFailure} from './failure.js';
const [root, revision, kind, destination, extra] = process.argv.slice(2);
assert(root && revision && kind && destination && isAbsolute(root) && isAbsolute(destination) && !extra && /^[a-f0-9]{40}$/.test(revision));
const selected = sourceCases(kind); let imageIds: Record<string, string> | undefined;
const cases: unknown[] = []; let valid = true;
for (const row of selected) {
 let raw: unknown;
 try {
  const path = join(root, row.id, 'outcome-private.json');
  raw = await (kind === 'long-stream' ? readLongReport(path) : readDeliveryJson(path));
  const value = publicCase(raw, row.id, revision); assert.equal(value.harnessNode, process.version);
  if (imageIds) assert.deepEqual(value.imageIds, imageIds); else imageIds = value.imageIds;
  cases.push(value);
 } catch {valid = false; cases.push(publicFailure(raw, row.id, revision));}
}
const git = (args: string[]) => execFileSync('git', args, {timeout: 10000, maxBuffer: 65536, encoding: 'utf8'}).trim();
const harnessRevision = git(['rev-parse', 'HEAD']); assert.equal(harnessRevision, process.env.GITHUB_SHA);
const harnessDirty = git(['status', '--porcelain', '--untracked-files=all']).length > 0;
const executionSucceeded = process.env.BEETLE_CONFORMANCE_EXECUTION === 'success';
const independentCleanupVerified = process.env.BEETLE_CONFORMANCE_CLEANUP === 'success';
const status = valid && !harnessDirty && executionSucceeded && independentCleanupVerified ? 'passed' : 'failed';
await writeFile(destination, JSON.stringify({format: 'beetle-native-source-conformance', version: 1, status, profile: kind, sourceRevision: revision,
 architecture: 'amd64', harnessRevision, harnessDirty, executionSucceeded, independentCleanupVerified, cases,
 limits: ['Synthetic finite cases only; no general availability or telemetry overhead claim', 'Memory is Docker usage, not process RSS']}, null, 2), {flag: 'wx', mode: 0o600});
if (status !== 'passed') process.exitCode = 1;
