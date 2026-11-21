import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { InputRecord } from '../../src/ports/inputs.js';
import {
  inspectColdMetadata,
  inspectColdMetadataForUpgrade,
} from '../../src/adapters/outbound/sqlite/cold-inspection/index.js';
import { createInput, inputOptions } from './inputs-fixture.js';
import { storageFixture, seed } from './fixture.js';
const fixture = storageFixture();

function cold<T>(path: string, work: (db: DatabaseSync, installationId: string) => T): T {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON');
    const id = String(db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get()!.id);
    return work(db, id);
  } finally {
    db.close();
  }
}

it('carries an unfinished upload across an upgrade while cold quiescence still refuses it', async () => {
  const path = fixture.path();
  const metadata = await fixture.open(path, inputOptions());
  await seed(metadata);
  const staged = (await metadata.inputs.control(createInput())) as InputRecord;
  expect(staged.state).toBe('staging');
  await fixture.close(metadata);
  cold(path, (db, id) => {
    expect(inspectColdMetadataForUpgrade(db, id).blockers).toEqual([]);
    expect(() => inspectColdMetadata(db, id)).toThrow(expect.objectContaining({ code: 'conflict' }));
  });
});
