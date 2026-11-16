import type { DiskRetention } from './retention.js';
import type { Resources } from './types.js';
import { resourceNames } from './types.js';

/** Compare by subtraction so representable retained debt never overflows a sum. */
export function retainedFit(candidate: Resources, active: Resources, pool: Resources, retention: DiskRetention): boolean {
  return resourceNames.every(name => {
    const retained = name === 'outputBytes' ? retention.outputBytes : name === 'stagingBytes' ? retention.stagingBytes : 0;
    const replay=name==='stagingBytes'?retention.replayBytes:0;
    const cleanup=name==='stagingBytes'?retention.cleanupBytes:0;
    return replay<=pool[name]&&cleanup<=pool[name]-replay&&retained <= pool[name]-replay-cleanup && active[name] <= pool[name]-replay-cleanup-retained
      && candidate[name] <= pool[name]-replay-cleanup-retained-active[name];
  });
}
