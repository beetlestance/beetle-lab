import {expect,it} from 'vitest';
import {encodeCanonicalJson,jsonNodeCount} from './json.js';
it('matches the encoder at the exact total-node boundary without serialized output',()=>{
 const value=Array.from({length:64},()=>Array(1023).fill(0));value.at(-1)!.pop();
 expect(jsonNodeCount(value)).toBe(65536);expect(()=>encodeCanonicalJson(value,16777216)).not.toThrow();
 value.at(-1)!.push(0);expect(()=>jsonNodeCount(value)).toThrow('request_limit');expect(()=>encodeCanonicalJson(value,16777216)).toThrow('request_limit');
});
it('matches depth and collection bounds',()=>{
 let value:unknown=0;for(let depth=0;depth<64;depth++)value=[value];expect(jsonNodeCount(value)).toBe(65);
 expect(()=>jsonNodeCount([value])).toThrow('request_limit');expect(jsonNodeCount(Array(4096).fill(0))).toBe(4097);expect(()=>jsonNodeCount(Array(4097).fill(0))).toThrow('request_limit');
});
it('rejects cycles, holes and accessors without invoking getters',()=>{
 const cycle:unknown[]=[];cycle.push(cycle);expect(()=>jsonNodeCount(cycle)).toThrow('invalid_json');expect(()=>jsonNodeCount(Array(1))).toThrow('invalid_json');
 let invoked=false;expect(()=>jsonNodeCount({get value(){invoked=true;return 0;}})).toThrow('invalid_json');expect(invoked).toBe(false);
});
