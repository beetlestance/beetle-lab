import type { RetentionDriverState } from '@beetle/contracts/api';
/** Advisory only. The callback must be a synchronous, read-only installed-owner view. */
export function cleanupDriverState(read:(()=>RetentionDriverState)|undefined):RetentionDriverState{
 if(!read)return'disabled';
 try{const value=read();return['running','stopped','disabled','unknown'].includes(value)?value:'unknown';}
 catch{return'unknown';}
}
