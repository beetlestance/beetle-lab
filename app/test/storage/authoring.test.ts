import { expect, it } from 'vitest';
import type { Run, Suite, SuiteRevision } from '@beetle/contracts/api';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { prepareRunNoteCommand } from '../../src/application/runs/index.js';
import { digest, requestId, scope, seed, settingsCommand, storageFixture, uuid } from './fixture.js';
import { append, createSuite, request, suiteCommand } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
import { inputOptions } from './inputs-fixture.js';

const fixture = storageFixture();
const noteCommand = (run: Pick<Run, 'id'>, expectedNoteVersion: number, note: string | null, id = requestId()) =>
  prepareRunNoteCommand({ kind: 'setRunNote', updatedAt: '2026-11-11T00:00:00.000Z', id: run.id, request: { scope, requestId: id, expectedNoteVersion, note } }, digest);
async function searchable(metadata: Metadata): Promise<void> {
  for (let step = 0; step < 40; step++) {
    try { await metadata.runs.listRuns({ scope, limit: 1, name: 'no such name' }); return; }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'search_indexing') throw error; }
  }
  throw new Error('Backfill exceeded fixture document budget');
}
const named = async (metadata: Metadata, name: string) =>
  (await metadata.runs.listRuns({ scope, limit: 10, name })).items.map((run) => run.id);

it('versions suite descriptions on create and patch, clearing with null', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const created = await metadata.suites.execute(suiteCommand({ kind: 'createSuite', id: uuid(50),
    request: { scope, requestId: requestId(), name: 'Checkout', description: '  Peak checkout path ' } })) as Suite;
  expect(created).toMatchObject({ version: 1, description: 'Peak checkout path' });
  const plain = await createSuite(metadata, 51);
  expect(plain.description).toBeNull();
  const patch = async (expectedVersion: number, description?: string | null) => metadata.suites.execute(suiteCommand({ kind: 'patchSuite',
    id: created.id, request: { scope, requestId: requestId(), expectedVersion, ...(description === undefined ? {} : { description }) } }));
  await expect(patch(1, 'x'.repeat(281))).rejects.toThrow();
  expect(await patch(1, 'Login path')).toMatchObject({ version: 2, description: 'Login path' });
  await expect(patch(1, 'Stale')).rejects.toMatchObject({ code: 'conflict' });
  expect(await patch(2, null)).toMatchObject({ version: 3, description: null });
  expect(await metadata.suites.getSuite({ scope, id: created.id })).toMatchObject({ version: 3, description: null });
  await fixture.close(metadata);
});

it('stamps revisions with server time, message and the administrator display name at save', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const suite = await createSuite(metadata);
  const body = { ...request(), message: 'Raise VUs' };
  const first = await append(metadata, suite, 60, body);
  expect(first).toMatchObject({ savedAt: '2026-11-10T00:00:00.000Z', message: 'Raise VUs', savedBy: 'Administrator' });
  const installation = await metadata.getSettings({ kind: 'installation' });
  await metadata.settings.execute(settingsCommand(installation.id, { scope: { kind: 'installation' }, schemaVersion: 2,
    requestId: requestId(), expectedVersion: installation.version, patch: { administratorName: 'Dana Ops' } }));
  const second = await metadata.suites.execute(suiteCommand({ kind: 'createSuiteRevision', savedAt: '2026-11-11T00:00:00.000Z',
    id: uuid(61), suiteId: suite.id, request: request(2) })) as SuiteRevision;
  expect(second).toMatchObject({ savedAt: '2026-11-11T00:00:00.000Z', message: null, savedBy: 'Dana Ops' });
  // Replay returns the original stamp even though the clock and display name moved on.
  expect(await append(metadata, suite, 62, body)).toEqual(first);
  const page = await metadata.suites.listRevisions({ scope, suiteId: suite.id, limit: 5 });
  expect(page.items.map((item) => item.savedBy).sort()).toEqual(['Administrator', 'Dana Ops']);
  await fixture.close(metadata);
});

it('sets, replays, conflicts and clears run notes without changing the run version', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata, 50, scope, 'Checkout'));
  const run = await metadata.runs.execute(runCommand(revision.id, 70));
  expect(await metadata.runs.getRun({ scope, id: run.id })).toMatchObject({ note: null, noteVersion: 0, startedAt: null, finishedAt: null });
  const command = noteCommand(run, 0, ' Warm cache baseline ');
  const noted = await metadata.runs.setNote(command);
  expect(noted).toMatchObject({ note: 'Warm cache baseline', noteVersion: 1, version: run.version, noteUpdatedAt: command.updatedAt });
  expect(await metadata.runs.setNote({...command, updatedAt: '2026-11-12T00:00:00.000Z'})).toEqual(noted);
  await expect(metadata.runs.setNote(noteCommand(run, 0, 'Stale'))).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.runs.setNote(noteCommand({ id: uuid(999) }, 0, 'Missing'))).rejects.toMatchObject({ code: 'not_found' });
  await searchable(metadata);
  expect(await named(metadata, 'cache base')).toEqual([run.id]);
  expect(await named(metadata, 'checkout')).toEqual([run.id]);
  const cleared = await metadata.runs.setNote(noteCommand(run, 1, null));
  expect(cleared).toMatchObject({ note: null, noteVersion: 2, version: run.version });
  expect(await named(metadata, 'cache base')).toEqual([]);
  expect((await metadata.runs.getRun({ scope, id: run.id })).noteVersion).toBe(2);
  await fixture.close(metadata);
});

it('merges note and suite matches once and refuses notes too broad for the posting budget', async () => {
  const metadata = await fixture.open(undefined, { ...runOptions(512), ...inputOptions(20_000_000) }); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata, 50, scope, 'Spike alpha'));
  const runs: Run[] = [];
  for (let id = 500; id < 758; id++) runs.push(await metadata.runs.execute(runCommand(revision.id, id)));
  for (const run of runs) await metadata.runs.setNote(noteCommand(run, 0, run.id === uuid(757) ? 'Spike alpha rerun' : 'Broad note'));
  await searchable(metadata);
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'broad note' })).rejects.toMatchObject({ code: 'search_too_broad' });
  const both = await metadata.runs.listRuns({ scope, limit: 1, name: 'spike alpha' });
  expect(both.items.map((run) => run.id)).toEqual([uuid(757)]);
  expect(await named(metadata, 'alpha rerun')).toEqual([uuid(757)]);
  await fixture.close(metadata);
});
