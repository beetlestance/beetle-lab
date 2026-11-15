import {setTimeout as delay} from 'node:timers/promises';
/** UI cadence: no new read until its own original settles, then wait two seconds. */
export async function pollLiveReader(read: () => Promise<void>, signal: AbortSignal) {
 while (!signal.aborted) {
  await read();
  if (!signal.aborted) await delay(2000, undefined, {signal}).catch(error => {if (!signal.aborted) throw error;});
 }
}
