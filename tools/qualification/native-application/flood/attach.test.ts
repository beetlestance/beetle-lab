import {expect,it} from 'vitest';
import {wrapperFailure} from './attach.js';
it('uses only complete exact wrapper failure frames and refuses oversized capture',()=>{
 expect(wrapperFailure('noise\n{"kind":"wrapper.error","reason":"output_limit"}\n')).toEqual(['output_limit']);
 expect(wrapperFailure('{"kind":"wrapper.error","reason":"output_limit","extra":true}\n{"kind":')).toEqual([]);
 expect(()=>wrapperFailure('x'.repeat(131073))).toThrow();
});
