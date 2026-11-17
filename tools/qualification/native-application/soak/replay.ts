/** Finish reads from a retained terminal trial; never enqueue or start a target. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { automaticSession } from '../compose/public.js';
import { finalDrain } from './final.js';
import { replaySource, terminalSnapshot } from './replay-source.js';
const [input, bundle, output, context = 'default', extra] = process.argv.slice(2);
assert(
  input && bundle && output && [input, bundle, output].every(isAbsolute) && !extra && /^v24\./.test(process.version),
);
await mkdir(output, { mode: 0o700 });
const source = await replaySource(input, bundle, output, context);
await writeFile(join(output, 'owner.json'), JSON.stringify({ ...source.owner, owner: randomUUID() }), {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(
  join(output, 'installation-owner.json'),
  JSON.stringify({ project: source.owner.project, installationId: source.installation }),
  { flag: 'wx', mode: 0o600 },
);
let status = 'failed';
let phase = 'terminal-precondition';
const results: Record<string, unknown> = {};
try {
  results.before = await terminalSnapshot(source.home, output, 'before', source.run);
  phase = 'resume-read-services';
  source.compose('up', '-d', '--no-build', '--no-deps', 'backend', 'agent', 'frontend');
  assert.equal(source.compose('ps', '--all', '-q', 'synthetic-target'), '');
  phase = 'final-drain';
  results.final = await finalDrain(await automaticSession(source.origin), source.run);
  assert.equal(
    source.docker.run([
      'ps',
      '-aq',
      '--filter',
      `label=dev.beetle.installation=${source.installation}`,
      '--filter',
      'label=dev.beetle.attempt',
    ]),
    '',
  );
  status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(
    join(output, 'failure-private.txt'),
    String(error instanceof Error ? error.stack : error).slice(0, 16384),
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  let cleanupVerified = false;
  try {
    source.compose('down', '--remove-orphans');
    cleanupVerified = true;
  } catch {
    status = 'failed';
    process.exitCode = 1;
  }
  if (cleanupVerified) {
    try {
      results.after = await terminalSnapshot(source.home, output, 'after', source.run);
    } catch {
      status = 'failed';
      process.exitCode = 1;
    }
  }
  await writeFile(
    join(output, 'outcome-private.json'),
    JSON.stringify(
      {
        status,
        phase,
        cleanupVerified,
        sourceRevision: source.owner.revision,
        sourceTrial: input,
        imageIds: source.imageIds,
        results,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ status, phase, cleanupVerified }));
}
