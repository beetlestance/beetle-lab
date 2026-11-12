import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { stat } from 'node:fs/promises';
import {retained} from './retained.js';
import { nativeFixture } from '../run-metrics/native-fixture.js';
import { storageFixture, scope } from '../storage/fixture.js';
import { context, finish } from '../files/output-bytes/fixture.js';
import { command } from './fixture.js';
const storage = storageFixture();
it('persists actual native preparation before unlink, reopens and replays absence without refunding retained producer custody', async () => {
  const f = await nativeFixture();
  try {
    const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path); const before = retained(path);
    let metadata = await storage.open(path, {runtime: null, runs: f.config}); const original = command(f);
    const summary = await metadata.outputDeletions.begin(original); const key = {scope, id: summary.id, runId: summary.runId};
    expect(summary.fileCount).toBe(f.source.descriptors.length); expect(summary.fileCount).toBeGreaterThan(0);
    const initialCharge = (await metadata.inputs.storage()).chargedBytes;
    for (let ordinal = 0; ordinal < summary.fileCount; ordinal++) {
      const fileKey = {...key, ordinal}; const file = await metadata.outputDeletions.getFile(fileKey);
      const native = await finish(f.files.store.prepareRemoval({record: file.record, deletionId: file.deletionId, deletionVersion: file.deletionVersion}, context()));
      const write = {key: fileKey, expectedVersion: file.version, plan: native};
      // Drop the usable caller reply after a real commit, then recover the same plan.
      await metadata.outputDeletions.recordPlan(write); await storage.close(metadata);
      metadata = await storage.open(path, {runtime: null, runs: f.config});
      const prepared = await metadata.outputDeletions.getFile(fileKey);
      expect(await metadata.outputDeletions.recordPlan(write)).toEqual(prepared);
      expect(prepared.namespaceIdentity).toBe(native.namespaceIdentity); expect(prepared.preparationIdentity).toBe(native.preparationIdentity);
      if (prepared.namespaceIdentity === null || prepared.preparationIdentity === null) throw new Error('Missing persisted native plan');
      const saved = {record: prepared.record, deletionId: prepared.deletionId, deletionVersion: prepared.deletionVersion,
        namespaceIdentity: prepared.namespaceIdentity, preparationIdentity: prepared.preparationIdentity};
      // Native namespace is reopened too: no in-memory preparation registry supplies authority.
      await f.files.reopen(); const absent = await finish(f.files.store.remove(saved, context()));
      await expect(stat(f.files.path(file.record, true))).rejects.toMatchObject({code: 'ENOENT'});
      await storage.close(metadata); metadata = await storage.open(path, {runtime: null, runs: f.config});
      const recoveredAbsence = await finish(f.files.store.remove(saved, context())); expect(recoveredAbsence).toEqual(absent);
      const receipt = {key: fileKey, expectedVersion: prepared.version, receipt: recoveredAbsence};
      await metadata.outputDeletions.recordAbsence(receipt); await storage.close(metadata);
      metadata = await storage.open(path, {runtime: null, runs: f.config});
      expect(await metadata.outputDeletions.recordAbsence(receipt)).toMatchObject({phase: 'absent', version: 3});
    }
    expect(await metadata.outputDeletions.get(key)).toMatchObject({stage: 'files_absent', absentCount: summary.fileCount, version: 1 + 2 * summary.fileCount});
    expect(await metadata.outputDeletions.begin(original)).toEqual(summary);
    expect(await metadata.outputDeletions.scan({limit: 32})).toEqual({items: [], nextCursor: null});
    expect((await metadata.inputs.storage()).chargedBytes).toBe(initialCharge);
    await expect(metadata.runArtifacts.listRunArtifacts({scope, id: key.runId, attemptId: f.key.attempt.attemptId, limit: 100})).rejects.toMatchObject({code: 'not_found'});
    expect((await metadata.results.getRunResult({scope, id: key.runId})).result).toEqual(f.envelope.manifest.result);
    expect(await metadata.finalizations.finalize(f.command())).toMatchObject({kind: 'finalized'});
    await storage.close(metadata); expect(retained(path)).toBe(before);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(1);
      expect(db.prepare('SELECT count(*) n FROM output_deletion_files WHERE absent=1').get()?.n).toBe(summary.fileCount);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {db.close();}
  } finally {await f.files.dispose();}
}, 20000);
