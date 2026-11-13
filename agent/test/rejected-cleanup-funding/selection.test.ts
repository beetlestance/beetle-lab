import { expect,it,vi } from 'vitest';
import { ProducerRetirement,producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { gateFor } from '../producer-gate/fixtures.js';
import { observation } from '../admission/fixtures.js';
import { retirementFixture } from '../retirement/fixtures.js';
import { fundingFixture } from './fixtures.js';
const f=fundingFixture();const admitted=retirementFixture();
it.each(['cancel','rejected'] as const)('selects %s from actual worker facts and funds before producer drain',async kind=>{
 const v=await f.ready(kind);const selected=await v.journal.retirements.select(v.request);
 expect(selected.funding).toBe('rejected');expect(await v.journal.retirements.read(v.key)).toBeNull();
 const gate=gateFor(v.journal,selected.intent.namespaceIdentity);
 const installation={retireOutput:vi.fn(async()=>{expect(await v.journal.retirements.read(v.key)).toEqual(selected.intent);})};
 const coordinator=new ProducerRetirement({journal:v.journal.retirements,funding:v.journal.retirements,gate,installation});
 const refused=coordinator.retire(v.request);expect((await refused.result).ok).toBe(false);await refused.settled;
 expect(coordinator.status().retained).toBe(0);expect(installation.retireOutput).not.toHaveBeenCalled();
 await v.journal.admission({kind:'observe',observation:observation(Date.now())});
 const work=coordinator.retire(v.request);const result=await work.result;await work.settled;
 if(!result.ok)throw Error('Expected producer barrier');expect(producerBarrierFacts(result.value).intent).toEqual(selected.intent);
 expect(installation.retireOutput).toHaveBeenCalledTimes(1);await coordinator.close();
});
it('selects admitted C1 independently and rejects a substituted closure before any grant',async()=>{
 const v=await admitted.ready();expect((await v.journal.retirements.select(v.request)).funding).toBe('admitted');
 await expect(v.journal.retirements.select({...v.request,closure:{...v.request.closure,proofDigest:'f'.repeat(64)}}))
  .rejects.toMatchObject({code:'conflict'});
 expect(await v.journal.retirements.read(v.key)).toBeNull();
});
