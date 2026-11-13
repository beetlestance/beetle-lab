import type { DiskRetention } from './retention.js';
import type { Resources } from './types.js';
import { resourceNames } from './types.js';

/** Compare by subtraction so representable retained debt never overflows a sum. */
export function retainedFit(candidate: Resources, active: Resources, pool: Resources, retention: DiskRetention): boolean {
  return resourceNames.every(name => {
    const retained = name === 'outputBytes' ? retention.outputBytes : name === 'stagingBytes' ? retention.stagingBytes : 0;
    const replay=name==='stagingBytes'?retention.replayBytes:0;
    return replay<=pool[name]&&retained <= pool[name]-replay && active[name] <= pool[name]-replay-retained
      && candidate[name] <= pool[name]-replay-retained-active[name];
  });
}
