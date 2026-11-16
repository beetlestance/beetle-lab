import { expect, it, vi } from 'vitest';
import { DockerBackend, isRuntimePlan, RuntimePlan } from '../../../src/backends/docker/index.js';
import { makePlan, operation } from './fixtures.js';

it('keeps real prepared plans branded while rejecting clones, proxies and reflective construction', () => {
  const plan = makePlan(); expect(isRuntimePlan(plan)).toBe(true);
  expect(isRuntimePlan(new Proxy(plan, {}))).toBe(false);
  const clone = Object.assign(Object.create(RuntimePlan.prototype), plan) as RuntimePlan;
  expect(isRuntimePlan(clone)).toBe(false);
  expect(() => Reflect.construct(RuntimePlan, [plan.name, plan.specDigest, plan.spec, Symbol('wrong')])).toThrow('invalid_runtime_plan');
  expect(Reflect.get(RuntimePlan, 'create')).toBeUndefined(); expect(Reflect.get(RuntimePlan, '#create')).toBeUndefined();
});
it('rejects a forged privileged plan before any Docker request', async () => {
  const plan = makePlan();
  const forged = Object.assign(Object.create(RuntimePlan.prototype), plan, {
    spec: { ...plan.spec, HostConfig: { ...plan.spec.HostConfig, Privileged: true } },
  }) as RuntimePlan;
  const request = vi.fn(); const backend = new DockerBackend({ request });
  expect(await backend.ensureCreated(forged, operation())).toMatchObject({ outcome: 'rejected', reason: 'invalid_input' });
  expect(await backend.inspect(forged, operation())).toEqual({ state: 'unknown', reason: 'invalid_input' });
  expect(await backend.stop(forged, operation(), performance.now() + 1000)).toMatchObject({ outcome: 'rejected', reason: 'invalid_input' });
  expect(request).not.toHaveBeenCalled();
});
