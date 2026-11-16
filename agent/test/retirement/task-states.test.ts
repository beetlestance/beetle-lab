import { expect, it } from 'vitest';
import { runtimeName } from '../../src/runtime-identity.js';
import { scope } from '../admission/fixtures.js';
import { rootFacts, directories } from '../staging-namespace/model-fixtures.js';
import { retirementFixture } from './fixtures.js';
const f = retirementFixture();
it.each(['preparing', 'prepared'] as const)('snapshots %s task metadata without inventing native removal permission', async state => {
  const v = await f.ready(true, async (journal, offer) => {
    const installed = await journal.stagingNamespace.read(); if (installed?.state !== 'bound') throw new Error('Missing namespace');
    const intent = { protocolVersion: 1 as const, original: { ...scope(offer), generation: 1 as const, intentDigest: offer.intentDigest },
      namespaceIdentity: installed.anchor.namespaceIdentity, purpose: 'performance' as const, specDigest: 'e'.repeat(64),
      runtimeName: runtimeName({ ...scope(offer), installationId: rootFacts.installationId }) };
    await journal.stagingNamespace.beginTask(intent);
    if (state === 'prepared') await journal.stagingNamespace.commitTask({ intent, directories: directories() });
  });
  const intent = await v.journal.retirements.begin(v.request);
  expect(intent.task.state).toBe(state); expect(Object.keys(intent).sort()).toEqual([
    'namespaceIdentity', 'protocolVersion', 'request', 'requestDigest', 'retirementVersion', 'task']);
  expect(await v.journal.retirements.begin(v.request)).toEqual(intent);
});
it('keeps rejected unreserved originals outside retirement instead of silently increasing their capacity', async () => {
  const v = await f.ready(); const journal = await f.open(); const offer = f.offer();
  await journal.cancelOriginal({ offer, now: 100_000 }); const key = scope(offer);
  const proof = await journal.closeOutputAbsence(key); if (!proof) throw new Error('Missing refusal');
  await expect(journal.retirements.preflight({ ...v.request, ...key, journalAuthority: await journal.journalAuthority(),
    intentDigest: offer.intentDigest, closure: { ...v.request.closure, finalAgentSeq: 0 } })).rejects.toMatchObject({ code: 'recovery_required' });
  expect(await journal.retirements.isOpen(key)).toBe(true);
});
