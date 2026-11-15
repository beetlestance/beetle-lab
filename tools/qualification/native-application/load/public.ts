/** CI-only closed report; neither execution nor cleanup failure can be promoted. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {readDeliveryJson} from '../../../delivery/files.js';
import {qualificationArchitecture} from '../../resources/values.js';
import {publicShortOutcome} from './outcome.js';
import {publicShortFailure} from './failure.js';
const [source, expectedRevision, destination, extra] = process.argv.slice(2);
assert(source && expectedRevision && destination && isAbsolute(source) && isAbsolute(destination) && !extra);
const raw = await readDeliveryJson(source);
let value: ReturnType<typeof publicShortOutcome> | ReturnType<typeof publicShortFailure>;
try {value = publicShortOutcome(raw, expectedRevision);}
catch {value = publicShortFailure(raw, expectedRevision);}
assert.equal(value.architecture, qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE));
assert.equal(value.harnessNode, process.version);
const git = (args: string[]) => execFileSync('git', args, {timeout: 10000, maxBuffer: 65536, encoding: 'utf8'}).trim();
const harnessRevision = git(['rev-parse', 'HEAD']); assert.match(harnessRevision, /^[a-f0-9]{40}$/); assert.equal(harnessRevision, process.env.GITHUB_SHA);
const harnessDirty = git(['status', '--porcelain', '--untracked-files=all']).length > 0;
const executionSucceeded = process.env.BEETLE_OBSERVATION_EXECUTION === 'success';
const independentCleanupVerified = process.env.BEETLE_OBSERVATION_CLEANUP === 'success';
if (harnessDirty || !executionSucceeded || !independentCleanupVerified) value.status = 'failed';
await writeFile(destination, JSON.stringify({...value, harnessRevision, harnessDirty, executionSucceeded, independentCleanupVerified}, null, 2), {flag: 'wx', mode: 0o600});
if (value.status !== 'passed') process.exitCode = 1;
