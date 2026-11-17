import assert from 'node:assert/strict';
import { readFile, lstat, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { readDeliveryJson } from '../../../delivery/files.js';
import { candidate } from '../load/candidate.js';
import { coldOwner } from '../cold/ownership.js';
import { installationOwner } from '../../resources/lifecycle/ownership.js';
import { composeProcesses } from '../compose/process.js';
import { record, counter } from '../../resources/values.js';
import { readLongReport } from './report.js';
export async function replaySource(input: string, bundle: string, output: string, context: string) {
  const owner = coldOwner(await readDeliveryJson(join(input, 'owner.json')));
  const installation = installationOwner(await readDeliveryJson(join(input, 'installation-owner.json')), owner.project);
  const { f } = await candidate(bundle, context);
  assert.equal(owner.revision, f.revision);
  const report = record(await readLongReport(join(input, 'outcome-private.json')));
  assert.equal(report.phase, 'final-drain');
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.sourceRevision, f.revision);
  assert.equal(report.architecture, f.architecture);
  assert.deepEqual(report.imageIds, f.imageIds);
  const stream = record(record(report.results).stream);
  const checked = validateApi('Run', stream.run);
  assert(checked.ok);
  assert.equal(checked.value.state, 'finished');
  assert.equal(checked.value.outcome, 'passed');
  const activeMs = stream.activeMs;
  assert(typeof activeMs === 'number' && Number.isFinite(activeMs) && activeMs >= 1800000);
  const home = join(owner.root, 'home/long-profile');
  const environment = await readFile(join(owner.root, 'compose.env'), 'utf8');
  assert(Buffer.byteLength(environment) <= 16384);
  const rows = environment
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([A-Z_]+)='([^'\r\n]*)'$/.exec(line);
      assert(match);
      return [match[1]!, match[2]!] as const;
    });
  const env = Object.fromEntries(rows);
  assert.equal(rows.length, 10);
  assert.equal(Object.keys(env).length, 10);
  assert.equal(env.BEETLE_HOME, home);
  assert.equal(env.BEETLE_INSTANCE, owner.project.slice(7));
  assert.equal(env.COMPOSE_PARALLEL_LIMIT, '1');
  for (const role of ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'] as const)
    assert.equal(env['BEETLE_' + (role === 'offline' ? 'EXPORT' : role.toUpperCase()) + '_IMAGE'], f.images[role]);
  const port = Number(env.BEETLE_PORT);
  assert(Number.isSafeInteger(port) && port >= 1 && port <= 65535);
  const override = record(await readDeliveryJson(join(owner.root, 'target.json')));
  assert.deepEqual(Object.keys(override), ['services']);
  assert.deepEqual(Object.keys(record(override.services)).sort(), ['setup', 'synthetic-target']);
  const recipe = await readFile('docker-compose.yml');
  const original = execFileSync('git', ['show', owner.revision + ':docker-compose.yml'], {
    timeout: 10000,
    maxBuffer: 65536,
  });
  assert.deepEqual(recipe, original);
  assert.equal(f.docker.run(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + owner.project]), '');
  const processes = composeProcesses(
    context,
    [
      'compose',
      '--project-name',
      owner.project,
      '--env-file',
      join(owner.root, 'compose.env'),
      '--file',
      resolve('docker-compose.yml'),
      '--file',
      join(owner.root, 'target.json'),
    ],
    output,
    env,
  );
  return {
    owner,
    installation,
    home,
    docker: f.docker,
    compose: processes.compose,
    run: checked.value,
    origin: `http://127.0.0.1:${port}`,
    imageIds: f.imageIds,
  };
}
export async function terminalSnapshot(home: string, output: string, phase: 'before' | 'after', run: Run) {
  const paths = [join(home, 'data/backend/metadata.sqlite'), join(home, 'data/agent/journal/journal.sqlite')];
  const copies = [];
  for (const [index, path] of paths.entries()) {
    const info = await lstat(path);
    assert(info.isFile() && info.size <= 16777216);
    try {
      assert.equal((await lstat(path + '-wal')).size, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const before = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const destination = join(output, `${phase}-${index}.sqlite`);
    await copyFile(path, destination, constants.COPYFILE_EXCL);
    assert.equal(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
      before,
    );
    copies.push(destination);
  }
  const backend = new DatabaseSync(copies[0]!, { readOnly: true });
  const agent = new DatabaseSync(copies[1]!, { readOnly: true });
  try {
    const runs = backend.prepare('SELECT id,state,outcome FROM runs LIMIT 2').all();
    assert.equal(runs.length, 1);
    const row = record(runs[0]);
    assert.equal(row.id, run.id);
    assert.equal(row.state, 'finished');
    assert.equal(row.outcome, 'passed');
    const executions = backend
      .prepare('SELECT attempt_id,execution_charged,event_pending FROM execution_records LIMIT 2')
      .all();
    assert.equal(executions.length, 1);
    const execution = record(executions[0]);
    assert.equal(execution.attempt_id, run.activeAttemptId);
    assert.equal(execution.execution_charged, 0);
    assert.equal(execution.event_pending, 0);
    const attempts = agent.prepare('SELECT attempt_id,state,delivery_pending FROM accepted_attempts LIMIT 2').all();
    assert.equal(attempts.length, 1);
    const attempt = record(attempts[0]);
    assert.equal(attempt.attempt_id, run.activeAttemptId);
    assert.equal(attempt.state, 'exited');
    const charges = agent.prepare('SELECT charged FROM reservations LIMIT 2').all();
    assert.equal(charges.length, 1);
    assert.equal(charges[0]!.charged, 0);
    return {
      runId: run.id,
      attemptId: run.activeAttemptId,
      performanceRuns: 1,
      acceptedAttempts: 1,
      executionReleased: true,
      eventDebt: 0,
      deliveryPending: counter(attempt.delivery_pending),
    };
  } finally {
    backend.close();
    agent.close();
  }
}
