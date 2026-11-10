import { expect, it } from 'vitest';
import type { SourceReceipt } from '../../src/output-source/index.js';
import { inspect, loseReply, sourceFixture } from './fixtures.js';
const f = sourceFixture();
it.each(['begin', 'source', 'release', 'failed'] as const)('reconciles genuine withheld post-COMMIT %s reply across reopen without another charge', async kind => {
  const e = await f.seed(); const { journal } = e; let receipt: SourceReceipt | undefined;
  if (kind !== 'begin') await journal.beginOutputCollection(e.intent);
  if (kind === 'release') receipt = await journal.commitOutputSource(e.collected);
  const issue = () => {
    if (kind === 'begin') return journal.beginOutputCollection(e.intent);
    if (kind === 'source') return journal.commitOutputSource(e.collected);
    if (kind === 'release') return journal.releaseOutputSource(receipt!);
    return journal.failOutputCollection(e.failed);
  };
  const actual = await loseReply(journal, issue);
  const before = inspect(e.path); expect(before.foreignKeys).toEqual([]);
  const settings = before.rows.find(entry => entry.table === 'admission_settings')?.rows[0];
  expect(typeof settings?.observation_json).toBe('string');
  if (!settings) throw new Error('Missing synthetic settings');
  settings.observation_json = null; // Process-owned readiness is deliberately cleared on reopen.
  const reopened = await f.open(e.path);
  expect(await reopened.journalAuthority()).toBe(e.intent.binding.journalAuthority);
  let replay: unknown;
  if (kind === 'begin') replay = await reopened.beginOutputCollection(e.intent);
  if (kind === 'source') replay = await reopened.commitOutputSource(e.collected);
  if (kind === 'release') replay = await reopened.releaseOutputSource(receipt!);
  if (kind === 'failed') replay = await reopened.failOutputCollection(e.failed);
  expect(replay).toEqual(actual);
  await f.close(reopened); expect(inspect(e.path)).toEqual(before);
});
