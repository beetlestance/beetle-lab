import { expect, it } from 'vitest';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { storageFixture, uuid } from '../storage/fixture.js';
import { requestedAt, retireWorkspace } from './fixture.js';
const storage = storageFixture();
it('reclaims through the real compiled metadata worker and validates the reply boundary', async () => {
  const f = claimsFixture();
  const path = storage.path();
  const { runId } = f.add();
  try {
    f.store.execute({ kind: 'cancelRun', command: cancelCommand(runId) });
    retireWorkspace(f.store, uuid(1), uuid(2));
    f.db.prepare('VACUUM INTO ?').run(path);
  } finally {
    f.db.close();
  }
  const metadata = await storage.open(path, { runtime: null, runs: f.config });
  const page = await metadata.outputDeletions.reclaimRetired({ limit: 32, requestedAt });
  expect(page).toMatchObject({ nextCursor: null, items: [{ runId, kind: 'unsent', requestedAt }] });
  expect(await metadata.outputDeletions.reclaimRetired({ limit: 32, requestedAt })).toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(metadata.outputDeletions.reclaimRetired({ limit: 0, requestedAt })).rejects.toMatchObject({
    code: 'invalid_input',
  });
  await expect(
    metadata.outputDeletions.reclaimRetired({ limit: 32, requestedAt, cursor: 'forged' }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await storage.close(metadata);
});
