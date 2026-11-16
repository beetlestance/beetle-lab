import type { OutputIO } from '../collection/output/index.js';
/** Check live producer/owner before each new effect, while actual late handles always remain closable. */
export function guardedNoTaskIO(lifetime:OutputIO,owner:()=>void):OutputIO{
 const check=()=>{lifetime.check();owner();};
 return{check,async io(action){check();const result=await lifetime.io(action);check();return result;},
  own:handle=>lifetime.own(handle),closeHandles:handles=>lifetime.closeHandles(handles)};
}
