import { encodeJson } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
/** One cooperative callback at a time is owned by the shared Notifications boundary. */
export function stdoutEvents() {
  let failed=false;const error=()=>{failed=true;};process.stdout.on('error',error);
  return Object.freeze({async send(event:ControlEvent):Promise<void> {
    if (failed) throw new Error('notification');const frame=encodeJson(event,65535)+'\n';
    await new Promise<void>((resolve,reject)=>process.stdout.write(frame,error=>error?reject(error):resolve()));
  },close(){process.stdout.removeListener('error',error);}});
}
