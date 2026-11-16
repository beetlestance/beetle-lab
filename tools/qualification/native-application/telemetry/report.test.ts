import {expect,it} from 'vitest';
import {encodeJson} from '@beetle/contracts';
import {privateReport} from './report.js';
const base={status:'passed' as const,installationId:'synthetic',agentPid:1,agentUid:1000,orderlyDrained:true,results:[]};
it('serializes success through the real strict encoder without an undefined failure property',()=>{
 const result=JSON.parse(encodeJson(privateReport({...base,failure:undefined}),262144));expect(result).toEqual(base);expect(Object.hasOwn(result,'failure')).toBe(false);
});
it('preserves an actual failure in a serializable failed report',()=>{
 const result=JSON.parse(encodeJson(privateReport({...base,status:'failed',failure:'known failure'}),262144));expect(result).toMatchObject({status:'failed',failure:'known failure'});
});
