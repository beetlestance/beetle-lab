import { expect, it } from 'vitest';
import { storageFixture } from '../storage/fixture.js';
import { fixture, keyFor, scope, uuid } from '../run-results/fixture.js';
const storage = storageFixture();
it('carries scoped compact authority through both actual worker captures and reopens unchanged', async () => {
  const f = fixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path, {runs: f.config}); const key = keyFor(f.key.runId);
  const value = await metadata.executions.getRunExecution(key);
  expect(value.binding).toEqual(f.binding); expect(value.run.activeAttemptId).toBe(f.key.attempt.attemptId);
  await expect(metadata.executions.getRunExecution({...key, scope: {...scope, workspaceId: uuid(999)}})).rejects.toMatchObject({code: 'not_found'});
  await expect(metadata.executions.getRunExecution({...key, extra: true} as typeof key)).rejects.toMatchObject({code: 'invalid_input'});
  await metadata.close(); metadata = await storage.open(path, {runs: f.config});
  expect(await metadata.executions.getRunExecution(key)).toEqual(value);
});
