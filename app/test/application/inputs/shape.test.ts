import { expect, it, vi } from 'vitest';
import { INPUT_SHAPE_LIMITS, shapeCounter, shapeKind } from '../../../src/application/inputs/shape.js';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { creation, transition, setup, key, source } from './fixture.js';

const fixture = storageFixture();
function count(kind: 'csv' | 'json', text: string | Uint8Array, split = 3) {
  const bytes = typeof text === 'string' ? Buffer.from(text) : text;
  const counter = shapeCounter(kind);
  for (let i = 0; i < bytes.length; i += split) counter.write(bytes.subarray(i, i + split));
  return counter.finish();
}

it('counts strict CSV records across chunk boundaries and refuses to guess on malformed input', () => {
  expect(count('csv', 'a,b\n1,2\n3,4\n')).toEqual({ rowCount: 2, columnCount: 2 });
  expect(count('csv', '﻿a,b\r\n"x,""y""\r\nz",2\r\n3,4', 1)).toEqual({ rowCount: 2, columnCount: 2 });
  expect(count('csv', 'only\n')).toEqual({ rowCount: 0, columnCount: 1 });
  expect(count('csv', 'a,b\n1\n')).toBeNull();
  expect(count('csv', 'a,b\n"1,2\n')).toBeNull();
  expect(count('csv', 'a,b\n1"x,2\n')).toBeNull();
  expect(count('csv', 'a,b\n"1"x,2\n')).toBeNull();
  expect(count('csv', new Uint8Array([0x61, 0x0a, 0xff, 0x0a]))).toBeNull();
  expect(count('csv', `${'a,'.repeat(INPUT_SHAPE_LIMITS.columns)}a\n`)).toBeNull();
  expect(count('csv', `h\n${'1\n'.repeat(INPUT_SHAPE_LIMITS.rows + 1)}`, 65536)).toBeNull();
  expect(count('csv', `h\n${'1\n'.repeat(INPUT_SHAPE_LIMITS.rows)}`, 65536)).toEqual({ rowCount: INPUT_SHAPE_LIMITS.rows, columnCount: 1 });
});

it('counts JSON arrays and reports columns only for uniform objects', () => {
  expect(count('json', '[{"a":1,"b":2},{"b":3,"a":4}]')).toEqual({ rowCount: 2, columnCount: 2 });
  expect(count('json', '[{"a":1},{"b":2}]')).toEqual({ rowCount: 2, columnCount: null });
  expect(count('json', '[{"a":1},{"a":1,"b":2}]')).toEqual({ rowCount: 2, columnCount: null });
  expect(count('json', '[1,2,3]')).toEqual({ rowCount: 3, columnCount: null });
  expect(count('json', '[]')).toEqual({ rowCount: 0, columnCount: null });
  expect(count('json', '{"a":[]}')).toBeNull();
  expect(count('json', '[1,')).toBeNull();
  const over = shapeCounter('json');
  over.write(new Uint8Array(INPUT_SHAPE_LIMITS.jsonBytes));
  over.write(new Uint8Array(1));
  expect(over.finish()).toBeNull();
});

it('selects only CSV and JSON names within the parse budget', () => {
  expect(shapeKind('Data.CSV', 10)).toBe('csv');
  expect(shapeKind('rows.json', INPUT_SHAPE_LIMITS.jsonBytes)).toBe('json');
  expect(shapeKind('rows.json', INPUT_SHAPE_LIMITS.jsonBytes + 1)).toBeNull();
  expect(shapeKind('rows.csv', 0)).toBeNull();
  expect(shapeKind('rows.txt', 10)).toBeNull();
});

async function published(name: string, content: string, overrides = {}) {
  const value = await setup(fixture, overrides);
  const command = creation(90, content);
  command.request.name = name;
  const created = (await value.service.control(command)) as InputRecord;
  const uploaded = await value.service.append(key(created), 0, source(content));
  await value.service.control(transition(uploaded, 'sealInput'));
  return { ...value, record: await value.service.get(key(created)) };
}

it('measures the verified published bytes once at publication', async () => {
  const csv = await published('data.csv', 'id,name\n1,a\n2,b\n3,c\n');
  try {
    expect(csv.record).toMatchObject({ state: 'published', rowCount: 3, columnCount: 2, usedByCount: 0 });
    expect(csv.record.publishedAt).toEqual(expect.any(String));
    expect(Date.parse(csv.record.publishedAt!)).toBeGreaterThanOrEqual(Date.parse(csv.record.createdAt!));
  } finally {
    await csv.service.close();
  }
  const other = await published('notes.txt', 'id,name\n1,a\n');
  try {
    expect(other.record).toMatchObject({ state: 'published', rowCount: null, columnCount: null });
  } finally {
    await other.service.close();
  }
});

it('keeps publication and leaves counts null when the measurement cannot complete', async () => {
  const recordShape = vi.fn(async () => {
    throw Object.assign(new Error('Storage unavailable'), { code: 'unavailable' });
  });
  const failing = await published('data.json', '[{"a":1}]', { recordShape });
  try {
    expect(recordShape).toHaveBeenCalledOnce();
    expect(failing.record).toMatchObject({ state: 'published', rowCount: null, columnCount: null });
  } finally {
    await failing.service.close();
  }
});
