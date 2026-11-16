import {expect,it} from 'vitest';
import {fixture,tracking} from './fixture.js';
const f=fixture();
it('refuses a valid result filename without independently reported completion',async()=>{
 const result=f.result();await f.write(result);
 const options=f.options(result);Reflect.deleteProperty(options,'reportedResult');const t=tracking();
 const collection=f.collect(options,t.ports);
 expect(await collection.result).toMatchObject({ok:false,reason:'invalid_options'});await collection.quiesced;
 expect(t.opened).toEqual([]);
});
