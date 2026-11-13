import { expect,it } from 'vitest';
import { fixture } from './fixture.js';
import { createInput,transition } from '../storage/inputs-fixture.js';
import { request,suiteCommand } from '../storage/suites-fixture.js';
import { uuid } from '../storage/fixture.js';
import type { InputRecord,InputReceipt } from '../../src/ports/inputs.js';
it('keeps real published input metadata, authoring pins and their entire independent charge',()=>{
 const f=fixture();let input=f.store.execute({kind:'input',command:createInput(90,12)}) as InputRecord;
 const key={scope:input.scope,id:input.id};
 input=f.store.execute({kind:'advanceInput',command:{kind:'commitInputOffset',key,expectedVersion:input.version,offset:input.bytes}}) as InputRecord;
 const accepted=f.store.execute({kind:'input',command:transition(input,'sealInput')}) as InputReceipt;
 input=f.store.execute({kind:'advanceInput',command:{kind:'publishInput',key,expectedVersion:accepted.acceptedVersion}}) as InputRecord;
 // Trusted publication metadata seam; this accounting test makes no byte-custody claim.
 const body=request(2);body.config.datasets=[{id:'data',kind:'json',selection:'byVu',input:{id:input.id,sha256:input.sha256,bytes:input.bytes}}];
 f.store.execute({kind:'suite',command:suiteCommand({kind:'createSuiteRevision',id:uuid(61),suiteId:uuid(50),request:body})});
 const pins=f.db.prepare('SELECT * FROM revision_input_pins').all();expect(pins).toHaveLength(1);
 const before=f.usage();const result=f.settle();expect(f.db.prepare('SELECT * FROM revision_input_pins').all()).toEqual(pins);
 expect(f.db.prepare('SELECT state FROM input_blobs WHERE id=?').get(input.id)?.state).toBe('published');
 expect(f.usage()).toBe(before-result.refundedBytes);expect(f.usage()).toBe(12+65536+2560);
 expect(()=>f.store.execute({kind:'input',command:transition(input,'deleteInput')})).toThrow();
});
