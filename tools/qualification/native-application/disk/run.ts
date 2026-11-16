import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {candidate} from '../load/candidate.js';
import {setup, startBackend, volumeOptions} from './fixture.js';
import {inputCase} from './case.js';
import {removeOwned} from './cleanup.js';
const [bundlePath, output, context = 'default', extra] = process.argv.slice(2);
assert(bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra && /^v24\./.test(process.version));
const {f} = await candidate(bundlePath, context); await mkdir(output, {mode: 0o700});
const owner = {root: f.root, project: f.project, revision: f.revision, owner: randomUUID()};
await writeFile(join(output, 'owner.json'), JSON.stringify(owner), {flag: 'wx', mode: 0o600});
await writeFile(join(output, 'disk-owner.json'), JSON.stringify({volume: `${f.project}-disk`, options: volumeOptions}), {flag: 'wx', mode: 0o600});
let status = 'failed'; let phase = 'provision'; let cleanupVerified = false; let backend: string | undefined;
const results: Record<string, unknown> = {};
try {
 const configured = setup(f, owner.owner);
 await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: configured.installationId}), {flag: 'wx', mode: 0o600});
 results.availableBeforeBytes = configured.availableBeforeBytes;
 phase = 'backend-start'; backend = startBackend(f, owner.owner, configured.volume, configured.network);
 phase = 'input-full-resume-delete'; results.input = await inputCase(f, configured, part => {results.partial = part;}, () => {f.docker.run(['restart', '--time', '5', backend!]);});
 assert.equal(f.docker.json<{State: {Running: boolean}}[]>(['inspect', configured.keeper])[0]!.State.Running, true); status = 'passed';
} catch (error) {process.exitCode = 1; await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});}
finally {
 if (backend) {try {await writeFile(join(output, 'backend-private.log'), f.docker.logs(backend), {flag: 'wx', mode: 0o600});} catch {results.logsUnavailable = true;}}
 try {removeOwned(f.docker, owner); cleanupVerified = true;} catch {status = 'failed'; process.exitCode = 1;}
 await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, sourceRevision: f.revision,
  architecture: f.architecture, harnessNode: process.version, imageIds: f.imageIds, environment: f.environment, volumeBytes: 67108864, results}, null, 2), {flag: 'wx', mode: 0o600});
 console.log(JSON.stringify({status, phase, cleanupVerified}));
}
