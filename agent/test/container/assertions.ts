import assert from 'node:assert/strict';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validate, verifyEngineResultSeal } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import { digest } from './fixture.js';
import type { Fixture } from './fixture.js';
import type { Inspection } from './docker.js';

export function released(f: Fixture): boolean {
  const db = new DatabaseSync(join(f.root, 'journal', 'journal.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT reservation_json FROM reservations LIMIT 2').all();
    return rows.length === 1 && JSON.parse(rows[0]!.reservation_json as string).status === 'released';
  } finally { db.close(); }
}
async function privateFile(f: Fixture, name: string): Promise<Buffer> {
  const path = join(f.root, 'staging', f.engine, 'output', name); const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.uid, f.uid); assert.equal(stat.gid, f.gid);
  assert.equal(stat.nlink, 1); assert.equal(stat.mode & 0o777, 0o600); assert(stat.size > 0 && stat.size <= 1_048_576);
  const bytes = await readFile(path); assert.equal(bytes.length, stat.size); return bytes;
}
export async function check(f: Fixture, snapshot: AttemptSnapshot): Promise<Record<string, unknown>> {
  const actual = f.docker.json<Inspection[]>(['inspect', f.engine])[0]!;
  await writeFile(join(f.root, 'engine-inspect.json'), JSON.stringify(actual, null, 2), { mode: 0o600 });
  assert.equal(actual.Image, f.engineImage.Id); assert.equal(actual.State.Running, false);
  assert.equal(actual.State.OOMKilled, false); assert.equal(actual.State.ExitCode, 0);
  const controls = actual.HostConfig;
  assert.equal(controls.NanoCpus, 1_000_000_000); assert.equal(controls.Memory, 536_870_912);
  assert.equal(controls.MemorySwap, 536_870_912); assert.equal(controls.PidsLimit, 128); assert.equal(controls.ReadonlyRootfs, true);
  assert.equal(snapshot.state, 'exited');
  const seal = verifyEngineResultSeal(JSON.parse((await privateFile(f, 'engine-result.json')).toString()), digest);
  assert(seal.ok); assert.deepEqual(snapshot.result, seal.value);
  const result = seal.value; const expected = f.workStatus === 200 ? 'passed' : 'failed';
  assert.equal(result.outcome, expected); assert.equal(result.execution.exitCode, f.workStatus === 200 ? 0 : 99);
  assert.deepEqual(result.requiredAssertions, { required: 1, passed: Number(f.workStatus === 200), failed: Number(f.workStatus === 500), unknown: 0 });
  assert.deepEqual(result.artifacts.map(item => item.relativePath).sort(), ['beetle-evidence.json', 'numeric-final.json']);
  for (const artifact of result.artifacts) {
    const bytes = await privateFile(f, artifact.relativePath); assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256);
  }
  const summary = JSON.parse((await privateFile(f, 'beetle-evidence.json')).toString()) as { metrics: { http_reqs: { values: { count: number } } } };
  assert.equal(summary.metrics.http_reqs.values.count, 1);
  const events = (await privateFile(f, 'control.ndjson')).toString().trimEnd().split('\n').map(line => {
    const value = validate('ControlEvent', JSON.parse(line)); assert(value.ok); return value.value;
  });
  for (const [index, event] of events.entries()) {
    assert.equal(event.seq, index + 1);
    for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) assert.equal(event[field], result[field]);
  }
  assert.deepEqual(events.filter(event => event.kind === 'phase.finished').map(event => event.phase), ['validate', 'prepare', 'execute', 'collect', 'seal']);
  assert(released(f));
  return { outcome: result.outcome, nativeExitCode: result.execution.exitCode, containerExitCode: actual.State.ExitCode,
    requiredAssertions: result.requiredAssertions, artifacts: result.artifacts.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })),
    events: events.length, measuredHttpRequests: 1, sealVerified: true, reservationReleased: true };
}
