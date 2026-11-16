import { expect,it } from 'vitest';
import { retirementFixture } from '../retirement/fixtures.js';
import { rootFacts,directories } from '../staging-namespace/model-fixtures.js';
import { scope } from '../admission/fixtures.js';
import { runtimeName } from '../../src/backends/docker/index.js';
const f=retirementFixture();
it.each(['preparing','prepared'] as const)('refuses a %s task as authority for no-task receipt storage',async state=>{
 const e=await f.ready(true,async(journal,offer)=>{
  const installed=await journal.stagingNamespace.read();if(installed?.state!=='bound')throw Error('Missing fixture namespace');
  const intent={protocolVersion:1 as const,original:{...scope(offer),generation:1 as const,intentDigest:offer.intentDigest},
   namespaceIdentity:installed.anchor.namespaceIdentity,purpose:'performance' as const,specDigest:'e'.repeat(64),runtimeName:runtimeName({...scope(offer),installationId:rootFacts.installationId})};
  await journal.stagingNamespace.beginTask(intent);if(state==='prepared')await journal.stagingNamespace.commitTask({intent,directories:directories()});
 });
 await e.journal.retirements.begin(e.request);const installed=await e.journal.stagingNamespace.read();if(installed?.state!=='bound')throw Error('Missing namespace');
 await expect(e.journal.noTaskReceipts.read({request:e.request,namespaceIdentity:installed.anchor.namespaceIdentity,
  taskName:runtimeName({...e.request,installationId:rootFacts.installationId}),daemonId:rootFacts.daemonId,root:rootFacts.native,markerDigest:installed.anchor.marker.sha256}))
  .rejects.toMatchObject({code:'conflict'});
 expect(await e.journal.retirements.read(e.key)).not.toBeNull();
});
