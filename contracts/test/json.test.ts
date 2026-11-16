import { expect, it, vi } from 'vitest';
import { encodeJson, readJson } from '../src/json.js';

it('bounds a scalar before stringify and rejects oversized key/property iteration', () => {
  const stringify = vi.spyOn(JSON, 'stringify');
  expect(() => encodeJson('x'.repeat(1000), 10)).toThrow();
  expect(stringify).not.toHaveBeenCalled();
  stringify.mockRestore();
  expect(() => encodeJson({ ['x'.repeat(1000)]: true }, 10)).toThrow();
  const many: Record<string, unknown> = {};
  for (let index = 0; index < 4097; index++) many[`k${index}`] = 0;
  expect(() => encodeJson(many, 100_000)).toThrow();
});

it('rejects non-JSON scalars, non-finite numbers, sparse arrays and cycles', () => {
  for (const input of [undefined, () => 1, Symbol('synthetic'), 1n, NaN, Infinity, [undefined], { x: undefined }]) {
    expect(() => encodeJson(input, 1000)).toThrow();
  }
  expect(() => encodeJson(new Array(2), 1000)).toThrow();
  expect(() => encodeJson(new Date(), 1000)).toThrow();
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(() => encodeJson(cycle, 1000)).toThrow();
  const getter = vi.fn(() => 'synthetic');
  const input = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
  expect(() => encodeJson(input, 1000)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('bounds nested data and preserves valid finite JSON without mutation', () => {
  const input = { nested: [null, true, '☃', 1, { a: 'line\n' }] };
  expect(encodeJson(input, 1000)).toBe(JSON.stringify(input));
  expect(() => encodeJson('☃'.repeat(10), 20)).toThrow();
  expect(() => encodeJson(Array.from({ length: 4097 }, () => 0), 100_000)).toThrow();
  let deep: unknown = 1;
  for (let index = 0; index < 65; index++) deep = { x: deep };
  expect(() => encodeJson(deep, 1000)).toThrow();
});

it('cancels overflow without retaining incoming chunks', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(100)); }, cancel,
  });
  await expect(readJson(new Response(stream), 32)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('bounds zero-byte fragmentation and cancels the stream', async () => {
  let fragments = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { fragments++; controller.enqueue(new Uint8Array(0)); }, cancel,
  });
  await expect(readJson(new Response(stream), 32)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fragments).toBeLessThanOrEqual(4098);
});

it('rejects malformed JSON/UTF-8 and reads a bounded valid document', async () => {
  await expect(readJson(new Response('{"a":}'), 100)).rejects.toThrow();
  await expect(readJson(new Response(new Uint8Array([0xff])), 100)).rejects.toThrow();
  await expect(readJson(new Response('{"a":1}'), 100)).resolves.toEqual({ a: 1 });
});


it('rejects invalid public serialization budgets before observing input', () => {
  const getter = vi.fn(() => 'synthetic');
  const input = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
  for (const maximum of [0, -1, NaN, Infinity, 0.5, 16_777_217]) {
    expect(() => encodeJson(input, maximum)).toThrow('invalid_limit');
  }
  expect(getter).not.toHaveBeenCalled();
});
