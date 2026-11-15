import {expect,it} from 'vitest';
import {readContent} from './public.js';
import {nativeFailure} from './failure.js';
it.each([403,409,503])('preserves only HTTP status %i when a content read is refused',async status=>{
 const response=new Response('SYNTHETIC_PRIVATE_BODY',{status});let failure:unknown;
 try{await readContent(response,4096);}catch(error){failure=error;}
 finally{await response.body?.cancel();}
 const diagnosis=nativeFailure(failure);
 expect(diagnosis).toMatchObject({code:'public_api',publicStatus:status});
 expect(JSON.stringify(diagnosis)).not.toContain('SYNTHETIC_PRIVATE_BODY');
});
