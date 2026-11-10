import { expect, it } from 'vitest';
import { absenceArguments, absenceCharge, rejectedFixture } from './absence-values.js';

it('requires two images and an optional local context without accepting status/extra controls', () => {
  expect(absenceArguments(['a:local', 'e:local', 'desktop-linux'])).toEqual({
    agentImage: 'a:local', engineImage: 'e:local', status: 200, context: 'desktop-linux' });
  for (const values of [[], ['a'], ['a', 'e', 'context', 'extra'], ['--privileged', 'e'], ['a', 'e', 'tcp://host']]) {
    expect(() => absenceArguments(values)).toThrow();
  }
});
it('derives only a positive below-minimum enqueue budget while preserving the configured original', () => {
  const budget = Object.freeze({ cpuMillis: 1000, memoryBytes: 536870912, pids: 128, timeoutMs: 30000, outputBytes: 16777216 });
  const manifest = Object.freeze({ minimumBudget: Object.freeze({ cpuMillis: 1000 }) });
  const original = Object.freeze({ budget, manifest, config: Object.freeze({ synthetic: true }) });
  const request = rejectedFixture(original);
  expect(request.budget).toEqual({ ...budget, cpuMillis: 999 }); expect(original.budget).toBe(budget);
  expect(request.manifest).toBe(manifest); expect(request.config).toBe(original.config);
  for (const cpuMillis of [0, 1, 1002, NaN, Infinity, 1.5]) {
    expect(() => rejectedFixture({ ...original, manifest: { minimumBudget: { cpuMillis } } })).toThrow();
  }
});
it('retains exact events plus actual provisional bytes, including zero event closure', () => {
  expect(absenceCharge(0, 0, 16777216)).toEqual({ events: 0, result: 0, retained: 0, refunded: 16777216, charged: 65536 });
  expect(absenceCharge(512, 1000, 4096)).toEqual({ events: 512, result: 1000, retained: 1512, refunded: 2584, charged: 67048 });
  for (const [events, result, maximum] of [[-1, 0, 1], [0, NaN, 1], [1, 1, 1], [0.5, 0, 2],
    [Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER], [0, 0, -1], [Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]]) {
    expect(() => absenceCharge(events!, result!, maximum!)).toThrow();
  }
});
