import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson } from '../src/index.js';

it('uses lexical keys recursively, including numeric keys, without reordering arrays', () => {
  const input = { z: [{ b: 2, a: 1 }, '☃'], '2': 'two', '10': 'ten', a: -0 };
  const expected = '{"10":"ten","2":"two","a":0,"z":[{"a":1,"b":2},"☃"]}';
  expect(encodeCanonicalJson(input, 1000)).toBe(expected);
  expect(encodeCanonicalJson(Object.fromEntries(Object.entries(input).reverse()), 1000)).toBe(expected);
  expect(input.z).toEqual([{ b: 2, a: 1 }, '☃']);
  expect(encodeCanonicalJson({ z: [...input.z].reverse() }, 1000)).not.toContain('[{"a":1');
});

it('enforces the final UTF8 byte limit, including escaping and delimiters', () => {
  const text = '{"a":"☃\\n"}';
  const bytes = new TextEncoder().encode(text).byteLength;
  expect(encodeCanonicalJson({ a: '☃\n' }, bytes)).toBe(text);
  expect(() => encodeCanonicalJson({ a: '☃\n' }, bytes - 1)).toThrow('request_limit');
});

it('rejects accessors without invoking them and never calls toJSON', () => {
  const getter = vi.fn(() => 'PRIVATE_CANARY');
  const input = Object.defineProperty({}, 'a', { enumerable: true, get: getter });
  expect(() => encodeCanonicalJson(input, 1000)).toThrow('invalid_json');
  const toJSON = vi.fn(() => ({}));
  expect(() => encodeCanonicalJson({ toJSON }, 1000)).toThrow('invalid_json');
  expect(getter).not.toHaveBeenCalled();
  expect(toJSON).not.toHaveBeenCalled();
});

it('bounds depth, object keys, array length and total nodes before finalization', () => {
  let deep: unknown = 0;
  for (let index = 0; index < 65; index++) deep = { a: deep };
  const many = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [String(index), 0]));
  const nodes = Array.from({ length: 4096 }, () => Array.from({ length: 16 }, () => 0));
  for (const input of [deep, many, new Array(4097).fill(0), nodes]) {
    expect(() => encodeCanonicalJson(input, 1_048_576)).toThrow('request_limit');
  }
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const input of [cycle, new Array(1), NaN, undefined, 1n, new Date(0)]) {
    expect(() => encodeCanonicalJson(input, 1000)).toThrow('invalid_json');
  }
});
