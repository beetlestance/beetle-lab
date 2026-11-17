import assert from 'node:assert/strict';
import type { Fixture } from '../compose/fixture.js';
import { record } from '../../resources/values.js';
function inspect(f: Fixture, id: string) {
  const rows = f.docker.json<unknown[]>(['inspect', id]);
  assert.equal(rows.length, 1);
  const row = record(rows[0]);
  assert.equal(row.Id, id);
  assert.equal(row.Image, f.imageIds.installer);
  const labels = record(record(row.Config).Labels);
  assert.equal(labels['com.docker.compose.project'], f.project);
  assert.equal(labels['org.opencontainers.image.revision'], f.revision);
  return record(row.State);
}
/** Detached Compose up is not successful completion of the one-shot installer. */
export function completedSetup(f: Fixture) {
  const id = f.compose('ps', '-a', '-q', 'setup');
  assert(/^[a-f0-9]{64}$/.test(id));
  inspect(f, id);
  assert.equal(f.docker.run(['wait', id]), '0');
  const state = inspect(f, id);
  assert.equal(state.Running, false);
  assert.equal(state.OOMKilled, false);
  assert.equal(state.ExitCode, 0);
  return { exitCode: 0, oomKilled: false };
}
