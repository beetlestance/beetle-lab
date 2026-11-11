import { expect, it } from 'vitest';
import { prepareRuntime } from '../../../src/backends/docker/index.js';
import { makeInput, makePlan } from './fixtures.js';
it('carves an immutable private mailbox tmpfs from the existing allowance only for trusted opt-in', () => {
  const input = makeInput(); const normal = makePlan(input);
  const enabled = makePlan({...input, profile: {...input.profile, liveMetricMailbox: true}});
  expect(enabled.spec.HostConfig.Tmpfs).toEqual({
    '/tmp': 'rw,noexec,nosuid,nodev,size=917504,mode=1777',
    '/beetle/live': 'rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=10001,gid=10001,mode=0700'});
  expect(enabled.spec.HostConfig.Memory).toBe(normal.spec.HostConfig.Memory);
  expect(enabled.spec.HostConfig.MemorySwap).toBe(normal.spec.HostConfig.MemorySwap);
  expect(enabled.spec.HostConfig.ShmSize).toBe(normal.spec.HostConfig.ShmSize);
  expect(enabled.spec.HostConfig.Mounts).toEqual(normal.spec.HostConfig.Mounts);
  expect(enabled.specDigest).not.toBe(normal.specDigest); expect(Object.isFrozen(enabled.spec.HostConfig.Tmpfs)).toBe(true);
});
it('does not enable a live channel from untrusted job config', () => {
  const input = makeInput(); input.offer.config = {liveMetricMailbox: true};
  expect(makePlan(input).spec.HostConfig.Tmpfs).not.toHaveProperty('/beetle/live');
});
it('rejects insufficient existing temporary allowance without increasing any budget', () => {
  const input = makeInput();
  expect(prepareRuntime({...input, profile: {...input.profile, liveMetricMailbox: true, tmpfsBytes: 131072}}).ok).toBe(false);
  const plan = makePlan({...input, profile: {...input.profile, liveMetricMailbox: true, tmpfsBytes: 135168}});
  expect(plan.spec.HostConfig.Tmpfs['/tmp']).toContain('size=4096,');
});
