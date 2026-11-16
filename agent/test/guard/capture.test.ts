import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { optionsCopy, requestCopy, resultCopy } from '../../src/guard/bounds.js';
import type { OutputGuardOptions } from '../../src/guard/types.js';
import { flush, known, request, setup } from './fixtures.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function wide<T extends object>(input: T) {
  const getter = vi.fn(() => { throw new Error('private getter observed'); });
  for (let index = 0; index < 1000; index++) Object.defineProperty(input, `private${index}`, { get: getter });
  const descriptors: string[] = [];
  const proxy = new Proxy(input, {
    ownKeys: () => { throw new Error('input key enumeration'); },
    getOwnPropertyDescriptor: (target, key) => {
      descriptors.push(String(key));
      if (String(key).startsWith('private')) throw new Error('private descriptor observed');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  return { proxy, getter, descriptors };
}
function options(): OutputGuardOptions {
  return { root: {} as OutputGuardOptions['root'], minimumFreeBytes: 1, stop: async () => undefined };
}
it('captures only the fixed options whitelist without enumerating wide input', () => {
  const input = wide(options()); expect(optionsCopy(input.proxy).minimumFreeBytes).toBe(1);
  expect(input.descriptors).toEqual(['root', 'minimumFreeBytes', 'intervalMs', 'ttlMs', 'sampleTimeoutMs', 'monotonicNow', 'stop']);
  expect(input.getter).not.toHaveBeenCalled();
});
it('captures only fixed watch and scope fields without observing private properties', () => {
  const value = request(); const key = wide(value.key); const input = wide({ ...value, key: key.proxy });
  expect(requestCopy(input.proxy).key).toEqual(value.key);
  expect(input.descriptors).toEqual(['key', 'plan', 'outputBytes']);
  expect(key.descriptors).toEqual(['organizationId', 'workspaceId', 'attemptId', 'generation']);
  expect(input.getter).not.toHaveBeenCalled(); expect(key.getter).not.toHaveBeenCalled();
});
it('captures only fixed scanner result fields without enumerating wide input', () => {
  const input = wide(known()); expect(resultCopy(input.proxy)).toEqual(known());
  expect(input.descriptors).toEqual(['kind', 'reason', 'startedAt', 'logicalBytes', 'allocatedBytes', 'chargedBytes', 'freeBytes']);
  expect(input.getter).not.toHaveBeenCalled();
});
it('rejects known accessors in options, request, scope and scanner result without reading them', () => {
  const getter = vi.fn(() => 1);
  const inputs = [options(), request(), request().key, known()];
  const keys = ['minimumFreeBytes', 'outputBytes', 'generation', 'startedAt'];
  inputs.forEach((input, index) => Object.defineProperty(input, keys[index]!, { get: getter }));
  expect(() => optionsCopy(inputs[0] as OutputGuardOptions)).toThrow('invalid_input');
  expect(() => requestCopy(inputs[1] as ReturnType<typeof request>)).toThrow('invalid_input');
  expect(() => requestCopy({ ...request(), key: inputs[2] as ReturnType<typeof request>['key'] })).toThrow('invalid_input');
  expect(() => resultCopy(inputs[3] as ReturnType<typeof known>)).toThrow('invalid_input');
  expect(getter).not.toHaveBeenCalled();
});
it('bounds recursive proxy watch intake before descriptor callbacks and releases the fence', async () => {
  const { service } = setup(); const input = request(); let calls = 0; let rejected = 0;
  const proxy = new Proxy(input, { getOwnPropertyDescriptor(target, key) {
    calls++;
    try { service.watch(proxy); } catch (error) { expect(String(error)).toContain('capacity'); rejected++; }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  const watch = service.watch(proxy); expect(calls).toBe(3); expect(rejected).toBe(3);
  expect(service.status().watched).toBe(1); expect(service.watch(input)).toBe(watch);
  await service.close();
});
it('rechecks service close after proxy descriptor callbacks', async () => {
  const { service, scan } = setup(); const proxy = new Proxy(request(), {
    getOwnPropertyDescriptor(target, key) { void service.close(); return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  expect(() => service.watch(proxy)).toThrow('closed'); await service.close();
  expect(service.status().watched).toBe(0); expect(scan).not.toHaveBeenCalled();
});
it('releases intake after malformed proxy and keeps the 64 registration capacity', async () => {
  const { service } = setup(); const malformed = new Proxy(request(), {
    getOwnPropertyDescriptor() { throw new Error('descriptor failure'); },
  });
  expect(() => service.watch(malformed)).toThrow('descriptor failure');
  for (let index = 1; index <= 64; index++) service.watch(request(index));
  expect(() => service.watch(request(65))).toThrow('capacity'); await service.close();
});
it('keeps result capture owned when descriptor callbacks close the service', async () => {
  const { service } = setup(vi.fn(async () => new Proxy(known(), {
    getOwnPropertyDescriptor(target, key) { void service.close(); return Reflect.getOwnPropertyDescriptor(target, key); },
  })));
  const watch = service.watch(request()); service.start(); await flush();
  expect(await watch.initial).toEqual({ ready: false }); await service.close();
  expect(watch.status().ready).toBe(false); expect(service.status().watched).toBe(0);
});
