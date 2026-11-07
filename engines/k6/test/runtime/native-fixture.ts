/** Native compatibility fixture: its HTTP adapter is synthetic and cannot connect. */
import '../../runtime/native-api.d.ts';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { counterNames } from '../../plan/index.js';
import type { CompiledSuite, DeepReadonly } from '../../plan/index.js';
import { createRuntime } from '../../runtime/index.js';
import type { Runtime } from '../../runtime/index.js';

export function createNativeUnit(suite: DeepReadonly<CompiledSuite>, failRequired: boolean): Runtime {
  const counters = new Map(counterNames.map(name => [name, new Counter(name)]));
  return createRuntime({ suite, resolveSecret: () => { throw new Error('unexpected_secret'); },
    adapters: { now: () => Date.now(), random: () => 0, sleep: milliseconds => sleep(milliseconds / 1000),
      http: () => ({ status: failRequired ? 500 : 200, transportFailed: false,
        headers: { 'x-id': 'a' }, body: '{"users":[{"id":1}],"message":"ok ready","count":1}' }),
      metric: (name, value, tags) => counters.get(name)!.add(value, tags) } });
}
