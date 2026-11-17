import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readDeliveryJson } from '../../../delivery/files.js';
import { qualificationArchitecture } from '../../resources/values.js';
import { publicColdOutcome } from './outcome.js';
const [source, destination, extra] = process.argv.slice(2);
assert(source && destination && isAbsolute(source) && isAbsolute(destination) && !extra);
const value = publicColdOutcome(await readDeliveryJson(source));
assert.equal(
  value.architecture,
  qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE),
);
const git = (args: string[]) =>
  execFileSync('git', args, { timeout: 10000, maxBuffer: 65536, encoding: 'utf8' }).trim();
const harnessRevision = git(['rev-parse', 'HEAD']);
assert.match(harnessRevision, /^[a-f0-9]{40}$/);
const harnessDirty =
  git([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'tools/qualification',
    'tools/delivery',
    'agent/test/container',
    'docker-compose.yml',
    'package.json',
    'package-lock.json',
  ]).length > 0;
if (harnessDirty) value.status = 'failed';
await writeFile(
  destination,
  JSON.stringify({ ...value, harnessRevision, harnessDirty, harnessNode: process.version }, null, 2),
  { flag: 'wx', mode: 0o600 },
);
if (value.status !== 'passed') process.exitCode = 1;
