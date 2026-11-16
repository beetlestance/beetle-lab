/** Manual staged compatibility path. Private Darwin seam; no container qualification. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { verifyEngineResultSeal } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
import { runAttempt } from '../../wrapper/attempt/attempt.js';
import { Execution } from '../../wrapper/execution/operation.js';
import { snapshot } from '../../wrapper/execution/profile.js';
import { productionPorts } from '../../wrapper/execution/ports.js';
import { ProcessActor } from '../../wrapper/process/actor.js';
import { nodeSpawn, ownedGroup } from '../../wrapper/process/ports.js';
import { validateProfile } from '../../wrapper/process/profile.js';
import { replayControl } from '../../wrapper/control/index.js';
import { stagedFixture } from './staged-fixture.js';

const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Provide the absolute native k6 v2.2.0 binary');
const version = execFileSync(binary, ['version'], { encoding: 'utf8', timeout: 5000,
  maxBuffer: 4096, env: { K6_NO_USAGE_REPORT: 'true' } }).trim();
assert.match(version, /^k6 v2\.2\.0\b/);
const canonicalBinary = await realpath(binary);
process.umask(0o077);

async function run(status: number): Promise<void> {
  const counts = { ready: 0, work: 0 };
  const server = createServer((request, response) => {
    if (request.url === '/ready') { counts.ready++; response.writeHead(200); response.end('ready'); }
    else if (request.url === '/work') { counts.work++; response.writeHead(status); response.end('ok'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let owned: Awaited<ReturnType<typeof stagedFixture>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events: ControlEvent[] = [];
  try {
    const address = server.address(); assert(address && typeof address !== 'string');
    owned = await stagedFixture(`http://127.0.0.1:${address.port}`);
    const installed = owned;
    timer = setTimeout(() => installed.controller.abort(), 20_000);
    const receipt = await runAttempt({ ...owned.options, onEvent: async event => {
      events.push(event);
      if (event.kind === 'engine.result') {
        assert.deepEqual(JSON.parse(await readFile(join(installed.outputRoot, 'engine-result.json'), 'utf8')), event.payload);
      }
    } }, {
      clock: { wall: Date.now, monotonic: performance.now.bind(performance) },
      execute: input => new Execution(snapshot({ ...input, binary: canonicalBinary, emptyConfig: installed.emptyConfig }),
        { ...productionPorts, native: options => new ProcessActor(options,
          { spawn: nodeSpawn, group: ownedGroup, validate: validateProfile }) }),
    });
    assert(receipt.ok, JSON.stringify(receipt)); assert(receipt.result && receipt.scope && receipt.execution);
    assert(Object.values(receipt.quiescence).every(value => value === 'confirmed'));
    assert.equal(receipt.result.outcome, status === 200 ? 'passed' : 'failed');
    assert.equal(receipt.result.execution.exitCode, status === 200 ? 0 : 99);
    assert.deepEqual(receipt.result.requiredAssertions, { required: 1, passed: Number(status === 200), failed: Number(status !== 200), unknown: 0 });
    assert.deepEqual(counts, { ready: 1, work: 1 });
    assert.equal(receipt.result.completeness, 'complete');
    const disk = JSON.parse(await readFile(join(owned.outputRoot, 'engine-result.json'), 'utf8')) as unknown;
    const verified = verifyEngineResultSeal(disk, sha256); assert(verified.ok); assert.deepEqual(verified.value, receipt.result);
    for (const artifact of receipt.result.artifacts) {
      const bytes: Buffer = await readFile(join(owned.outputRoot, artifact.relativePath));
      assert.equal(bytes.length, artifact.bytes); assert.equal(sha256(bytes), artifact.sha256);
    }
    const replay = await replayControl({ directory: owned.outputRoot, scope: receipt.scope, quotaBytes: 262_144, after: 0 },
      { deadline: performance.now() + 2000 });
    assert.equal(replay.state, 'complete'); assert.deepEqual(replay.events, events);
    assert.deepEqual(events.filter(event => event.kind === 'phase.started').map(event => event.phase),
      ['validate', 'prepare', 'execute', 'collect', 'seal']);
    assert.deepEqual(receipt.result.artifacts.map(artifact => artifact.relativePath).sort(),
      ['beetle-evidence.json', 'numeric-final.json']);
    console.log(JSON.stringify({ directory: owned.root, version, counts, outcome: receipt.result.outcome,
      quiescence: receipt.quiescence, artifacts: receipt.result.artifacts, stream: receipt.execution.stream,
      journalBytes: replay.snapshotBytes, events: replay.events.length }));
  } finally {
    clearTimeout(timer); owned?.controller.abort();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
for (const status of [200, 500]) await run(status);
