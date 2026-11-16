import { initialize } from '../../src/journal/schema.js';
import { Store } from '../../src/journal/store.js';
import { expect, it } from 'vitest';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { runtimeName } from '../../src/runtime-identity.js';
import { captureCollectionIntent } from '../../src/output-source/index.js';
import { sourceFixture } from '../source-journal/fixtures.js';
import { scope } from '../admission/fixtures.js';
import type { TaskNamespaceIntent } from '../../src/staging-namespace/index.js';
import { directories, rootFacts } from '../staging-namespace/model-fixtures.js';
const f = sourceFixture();
async function step<T>(label: string, original: Promise<T>): Promise<T> {
  try { return await original; } catch (cause) { throw new Error(label, { cause }); }
}
it('requires actual prepared task/source root binding, then fences late source and preparation writes', async () => {
  let intent!: TaskNamespaceIntent; const facts = directories(); let name = '';
  const v = await f.seed(f.path(), async ({ journal, offer, specDigest }) => {
    const installed = await journal.stagingNamespace.read();
    if (installed?.state !== 'bound') throw new Error('Missing bound namespace');
    const key = scope(offer); name = runtimeName({ ...key, installationId: rootFacts.installationId });
    intent = { protocolVersion: 1, original: { ...key, generation: 1, intentDigest: offer.intentDigest }, purpose: 'performance',
      namespaceIdentity: installed.anchor.namespaceIdentity, specDigest, runtimeName: name };
    await step('begin task', journal.stagingNamespace.beginTask(intent));
    await step('commit task', journal.stagingNamespace.commitTask({ intent, directories: facts }));
  });
  v.collected.collection.custody.root = { ...v.collected.collection.custody.root,
    directory: rootFacts.target + '/' + name + '/output', device: facts.output.dev, inode: facts.output.ino, uid: Number(facts.output.uid) };
  const collection = captureCollectionIntent({ ...v.intent, root: v.collected.collection.custody.root });
  await step('begin collection', v.journal.beginOutputCollection(collection));
  const receipt = await step('commit source', v.journal.commitOutputSource(v.collected)); await step('release source', v.journal.releaseOutputSource(receipt));
  const snapshot = await v.journal.get(v.key);
  await v.journal.acknowledge({ protocolVersion: '1.0', ...v.key, throughSeq: snapshot.lastSeq });
  await step('close delivery', v.journal.closeOutputDelivery(receipt));
  const request: RetirementRequest = { version: 1, purpose: 'performance', ...v.key, generation: 1,
    intentDigest: v.offer.intentDigest, journalAuthority: receipt.journalAuthority,
    runId: '00000000-0000-4000-8000-000000000201', deletionId: '00000000-0000-4000-8000-000000000202', deletionVersion: 1,
    closure: { kind: 'source', sourceDigest: receipt.sourceDigest, manifestDigest: receipt.manifestDigest, finalAgentSeq: snapshot.lastSeq } };
  await f.close(v.journal); const db = initialize(v.path);
  try { new Store(db).execute({ kind: 'retirementBegin', id: 999, json: JSON.stringify(request) }); } finally { db.close(); }
  v.journal = await f.open(v.path);
  const retirement = await v.journal.retirements.begin(request);
  expect(retirement.task.state).toBe('prepared');
  await expect(v.journal.beginOutputCollection(collection)).rejects.toMatchObject({ code: 'conflict' });
  await expect(v.journal.commitOutputSource(v.collected)).rejects.toMatchObject({ code: 'conflict' });
  await expect(v.journal.stagingNamespace.beginTask(intent)).rejects.toMatchObject({ code: 'conflict' });
  await expect(v.journal.stagingNamespace.commitTask({ intent, directories: facts })).rejects.toMatchObject({ code: 'conflict' });
  expect(await v.journal.readOutputSource(v.key)).not.toBeNull();
  expect(await v.journal.readOutputDelivery(v.key)).not.toBeNull();
});
