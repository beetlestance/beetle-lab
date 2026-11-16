import {expect,it} from 'vitest';
import {storageFixture,seed,scope,uuid,digest,requestId} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {prepareNamespaceDeletion} from '../../src/application/namespace-deletion/index.js';
import {options,createCommand} from './fixture.js';
const fixture=storageFixture();
it('refuses queued and claimed standalone export work while retaining exact original custody',async()=>{
 const metadata=await fixture.open(undefined,options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const deletion=()=>prepareNamespaceDeletion({kind:'workspace',id:uuid(2),request:{scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),expectedVersion:1}},digest);
 const before=await metadata.inputs.storage();
 await expect(metadata.namespaceDeletions.delete(deletion())).rejects.toMatchObject({code:'conflict'});expect(await metadata.inputs.storage()).toEqual(before);
 expect((await metadata.exportExecutions.claim(key)).kind).toBe('claimed');const charged=await metadata.inputs.storage();const original=await metadata.exportExecutions.original(key);
 await expect(metadata.namespaceDeletions.delete(deletion())).rejects.toMatchObject({code:'conflict'});expect(await metadata.inputs.storage()).toEqual(charged);
 expect(await metadata.exportExecutions.original(key)).toEqual(original);
 expect(await metadata.get({kind:'workspace',id:uuid(2),scope:{kind:'organization',organizationId:uuid(1)}})).toMatchObject({id:uuid(2)});
});
