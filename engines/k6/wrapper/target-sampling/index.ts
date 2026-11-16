import { Sampler } from './sampler.js';
import type { TargetSamplingOptions, TargetSamplingOwner } from './types.js';
export type * from './types.js';

/** Owns original fetch/body completion; callers must await finish or close. */
export async function startTargetSampling(options: TargetSamplingOptions): Promise<TargetSamplingOwner> {
  const sampler = new Sampler(options);
  await sampler.start();
  return sampler;
}
