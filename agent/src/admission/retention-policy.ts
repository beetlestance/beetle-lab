import type { DiskRetention } from './retention.js';
import type { Resources } from './types.js';
import { resourceNames } from './types.js';

/** Compare by subtraction so representable retained debt never overflows a sum. */
export function retainedFit(candidate: Resources, active: Resources, pool: Resources, retention: DiskRetention): boolean {
  return resourceNames.every(name => {
    const retained = name === 'outputBytes' ? retention.outputBytes : name === 'stagingBytes' ? retention.stagingBytes : 0;
    return retained <= pool[name] && active[name] <= pool[name] - retained
      && candidate[name] <= pool[name] - retained - active[name];
  });
}
