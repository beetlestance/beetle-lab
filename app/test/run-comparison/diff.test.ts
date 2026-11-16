import { expect, it } from 'vitest';
import { configDifferences } from '../../src/application/run-comparison/diff.js';
it('returns pointer-only changes, escapes keys and distinguishes added/removed/null', () => {
  const left = {same: [1, null], removed: 'SYNTHETIC_CANARY', 'a/~': 1};
  const right = {same: [1, null], added: null, 'a/~': 2}; const result = configDifferences(left, right);
  expect(result).toEqual({limited: false, configChanges: [
    {path: '/a~1~0', change: 'changed'}, {path: '/added', change: 'added'}, {path: '/removed', change: 'removed'},
  ]});
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_CANARY'); expect(configDifferences(left, structuredClone(left))).toEqual({limited: false, configChanges: []});
});
it.each([100, 101])('reports exact100 versus limited101 changes (%s)', count => {
  const result = configDifferences(Object.fromEntries(Array.from({length: count}, (_, i) => [`key${i}`, 0])),
    Object.fromEntries(Array.from({length: count}, (_, i) => [`key${i}`, 1])));
  expect(result.configChanges).toHaveLength(100); expect(result.limited).toBe(count > 100);
});
it('bounds encoded pointer bytes without truncating into a different path', () => {
  const exact = 'x'.repeat(509); const over = 'x'.repeat(510);
  expect(configDifferences({[exact]: 0}, {[exact]: 1})).toEqual({limited: false, configChanges: [{path: '/' + exact, change: 'changed'}]});
  expect(configDifferences({[over]: 0}, {[over]: 1})).toEqual({limited: true, configChanges: [{path: '', change: 'changed'}]});
});
it('limits depth, wide branches, pending pairs and total visited work explicitly', () => {
  let left: unknown = 0; let right: unknown = 1;
  for (let i = 0; i < 66; i++) {left = {level: left}; right = {level: right};}
  expect(configDifferences(left, right).limited).toBe(true);
  const wide = Object.fromEntries(Array.from({length: 4097}, (_, i) => [`key${i}`, 0]));
  expect(configDifferences(wide, structuredClone(wide)).limited).toBe(true);
  const nested = Array.from({length: 256}, () => Array<number>(256).fill(0));
  expect(configDifferences(nested, structuredClone(nested))).toEqual({limited: true, configChanges: [{path: '', change: 'changed'}]});
});
it('reads prototype-looking JSON keys as data without changing prototypes', () => {
  const left: unknown = JSON.parse('{"__proto__":{"canary":0}}'); const right: unknown = JSON.parse('{"__proto__":{"canary":1}}');
  expect(configDifferences(left, right)).toEqual({limited: false, configChanges: [{path: '/__proto__/canary', change: 'changed'}]});
  expect(Object.hasOwn(Object.prototype, 'canary')).toBe(false);
});

it('marks unrepresentable schema pointers as limited instead of emitting an invalid response', () => {
  const left = {'header\nname': 0}; const right = {'header\nname': 1};
  expect(configDifferences(left, right)).toEqual({limited: true, configChanges: [{path: '', change: 'changed'}]});
});
