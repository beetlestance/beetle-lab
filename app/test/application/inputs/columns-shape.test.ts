import { expect, it } from 'vitest';
import { shapeCounter } from '../../../src/application/inputs/shape.js';
function columns(kind: 'csv' | 'json', value: string, split = 1) {
  const counter = shapeCounter(kind);
  const bytes = new TextEncoder().encode(value);
  expect(counter.columnNames()).toBeNull();
  for (let index = 0; index < bytes.length; index += split) counter.write(bytes.subarray(index, index + split));
  const shape = counter.finish();
  return { shape, columns: counter.columnNames() };
}
it('discovers exact CSV header spelling/order across quoted headers, split CRLF and UTF-8 body chunks', () => {
  expect(columns('csv', '\ufeff"cartId",currency\r\n"café","INR"\r\n')).toEqual({
    shape: { rowCount: 1, columnCount: 2 },
    columns: ['cartId', 'currency'],
  });
  expect(columns('csv', 'b,a\n1,2')).toEqual({ shape: { rowCount: 1, columnCount: 2 }, columns: ['b', 'a'] });
});
it('never sanitizes or truncates unsafe, duplicate, long, escaped or excessive names', () => {
  for (const header of [
    'id,id',
    '__proto__',
    'prototype',
    'constructor',
    'not.valid',
    '名字',
    '"a""b"',
    'a'.repeat(65),
    Array.from({ length: 65 }, (_, i) => 'c' + i).join(','),
  ])
    expect(columns('csv', header + '\n').columns).toBeNull();
  expect(columns('csv', 'a'.repeat(64) + '\n').columns).toEqual(['a'.repeat(64)]);
});
it('does not expose a valid header after malformed rows, including a mismatched final record without newline', () => {
  expect(columns('csv', 'a,b\n1').shape).toBeNull();
  expect(columns('csv', 'a,b\n1').columns).toBeNull();
  expect(columns('csv', 'a,b\n"unterminated').columns).toBeNull();
  expect(columns('csv', 'a,b\n1,2,3\n').columns).toBeNull();
});
it('sorts exact JSON object keys, requires uniform objects, and treats discovery as distinct from semantic compilation', () => {
  expect(columns('json', '[{"b":null,"a":{"nested":true}},{"a":1,"b":2}]').columns).toEqual(['a', 'b']);
  for (const value of ['[]', '[1,2]', '[{"a":1},{"b":2}]', '[{"constructor":1}]', '[{"a":'])
    expect(columns('json', value).columns).toBeNull();
  const over = shapeCounter('json');
  over.write(new Uint8Array(2_097_153));
  expect(over.finish()).toBeNull();
  expect(over.columnNames()).toBeNull();
});
