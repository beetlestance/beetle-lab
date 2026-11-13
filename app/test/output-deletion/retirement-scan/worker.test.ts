import {expect,it} from 'vitest';
import {storageFixture} from '../../storage/fixture.js';
import {fixture} from '../cleanup-ack/fixture.js';
const storage=storageFixture();
it('discovers through the compiled worker, persists its ACK and skips it after reopen without refunds',async()=>{
 const f=fixture();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);
 let metadata=await storage.open(path,{runtime:null,runs:f.config});const before=await metadata.inputs.storage();
 expect((await metadata.outputDeletions.scanRetirements({limit:32})).items.map(item=>item.id)).toEqual([f.key.id]);
 const {cleaned}=await import('../cleanup-ack/fixture.js');const request=await metadata.outputDeletions.retirementRequest(f.key);
 await metadata.outputDeletions.recordCleanupAck({key:f.key,reply:cleaned(request)});await storage.close(metadata);
 metadata=await storage.open(path,{runtime:null,runs:f.config});
 expect(await metadata.outputDeletions.scanRetirements({limit:32})).toEqual({items:[],nextCursor:null});
 expect(await metadata.inputs.storage()).toEqual(before);await storage.close(metadata);
});
