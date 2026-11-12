import {expect,it} from 'vitest';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
it('round-trips a 690KB UTF-8 assignment through the compiled worker and shares two original-carrier credits',async()=>{
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const requests=body.config.requests as Record<string,unknown>[];requests[0]!.body={kind:'json',value:{payload:'界'.repeat(230000)}};
 const revision=await append(metadata,await createSuite(metadata),60,body);const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const first=metadata.exportExecutions.original(key);const second=metadata.exportExecutions.original(key);
 await expect(metadata.exportExecutions.original(key)).rejects.toMatchObject({code:'queue_full'});
 const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);expect(a.assignment.offer.config).toEqual(revision.config);
 expect(Buffer.byteLength(JSON.stringify(a.assignment))).toBeGreaterThan(690000);
 const claim=await metadata.exportExecutions.claim(key);expect(claim.kind).toBe('claimed');
 const next=await metadata.exportExecutions.original(key);expect(next.assignment).toEqual(a.assignment);expect(next.possibleDelivery).toBe(true);
});
