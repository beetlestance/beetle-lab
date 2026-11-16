import type { Resources } from './types.js';
import { resourceNames } from './types.js';
export const MAX_RESOURCE_VALUE = Math.floor(Number.MAX_SAFE_INTEGER / 256);

export const zeroResources = (): Resources => ({ cpuMillis: 0, memoryBytes: 0, pids: 0, outputBytes: 0, stagingBytes: 0 });
export function validResources(value: Resources): boolean {
  return resourceNames.every(name => Number.isSafeInteger(value[name]) && value[name] >= 0);
}
export function fits(request: Resources, capacity: Resources): boolean {
  return resourceNames.every(name => request[name] <= capacity[name]);
}
export function addResources(left: Resources, right: Resources): Resources {
  const sum = zeroResources();
  for (const name of resourceNames) {
    if (right[name] > Number.MAX_SAFE_INTEGER - left[name]) throw new Error('invalid_input');
    sum[name] = left[name] + right[name];
  }
  return sum;
}
export function effectivePool(pool: Resources, runtime: Resources, overhead: Resources): Resources {
  const result = zeroResources();
  for (const name of resourceNames) result[name] = Math.max(0, Math.min(pool[name], runtime[name] - overhead[name]));
  return result;
}
