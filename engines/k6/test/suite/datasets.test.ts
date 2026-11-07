import { describe, expect, it } from 'vitest';
import { selectDatasetRows } from '../../compiler/suite/index.js';
import { parseCsv } from '../../compiler/suite/csv.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { compiled, dependencies, fixture, input } from './fixtures.js';
describe('datasets and coherent row selection', () => {
  it('parses inline, JSON, CSV, ranges and token columns into one row owner', () => {
    const json = input('[{"a":1,"b":true},{"b":false,"a":null}]');
    const csv = input('\uFEFFname,token\r\n"one,first","a""b"\r\n"two\nsecond",t2\r\n', 2);
    const config = fixture(); config.datasets.push(
      { id: 'json', kind: 'json', input: json.ref, selection: 'byVu' },
      { id: 'csv', kind: 'csv', input: csv.ref, selection: 'random' });
    const value = compiled(config, dependencies([json, csv]));
    expect(value.datasets[1]?.rows).toEqual([{ value: 1 }, { value: 3 }, { value: 5 }]);
    expect(value.datasets[2]?.rows).toEqual([{ a: 1, b: true }, { a: null, b: false }]);
    expect(value.datasets[3]?.rows).toEqual([{ name: 'one,first', token: 'a"b' }, { name: 'two\nsecond', token: 't2' }]);
    let samples = 0;
    const rows = selectDatasetRows(value.datasets, { vu: 2, iteration: 100 }, () => { samples++; return 0.99; });
    expect(samples).toBe(2);
    expect(rows.ok && rows.value[0]).toMatchObject({ datasetId: 'users', rowIndex: 1, row: { user: 'two', token: 't2' } });
    expect(rows.ok && rows.value[1]).toMatchObject({ datasetId: 'numbers', rowIndex: 1, row: { value: 3 } });
    const tokens = value.requests[0]!.path.tokens;
    expect(tokens[1]).toEqual({ kind: 'data', datasetId: 'users', column: 'user' });
    expect(value.requests[0]!.headers[1]!.value.tokens[0]).toEqual({ kind: 'data', datasetId: 'users', column: 'token' });
  });
  it('supports empty and escaped CSV cells and embedded CRLF faithfully', () => {
    expect(parseCsv('a,b,c\n,"x\r\ny",""\n')).toEqual([['a', 'b', 'c'], ['', 'x\r\ny', '']]);
    expect(parseCsv('a,b\nx,')).toEqual([['a', 'b'], ['x', '']]);
    expect(parseCsv('a,b\nx,y\r')).toEqual([['a', 'b'], ['x', 'y']]);
  });
  it.each(['a,a\nx,y', 'a,b\nx', 'a,b\nx,y,z', 'a\n"unterminated', 'a\n"x"tail', 'a\nno"quote', '', 'a\n', '__proto__\nx'])('rejects invalid CSV %j', content => {
    const csv = input(content); const config = fixture();
    config.datasets.push({ id: 'bad', kind: 'csv', input: csv.ref, selection: 'random' });
    expect(validateAndCompileSuite(config, dependencies([csv])).ok).toBe(false);
  });
  it.each(['[]', '{}', '[1]', '[{"a":[]}]', '[{"a":1},{"b":2}]', '[{"constructor":1}]', '[{"a":1e999}]', '[not-json]'])('rejects invalid JSON dataset %j', content => {
    const json = input(content); const config = fixture();
    config.datasets.push({ id: 'bad', kind: 'json', input: json.ref, selection: 'random' });
    expect(validateAndCompileSuite(config, dependencies([json])).ok).toBe(false);
  });
  it('accepts exactly 10000 CSV and JSON rows', () => {
    const config = fixture(); const csv = input('a\n' + Array.from({ length: 10_000 }, () => 'x').join('\n'));
    const json = input(JSON.stringify(Array.from({ length: 10_000 }, () => ({ a: 1 }))), 2);
    config.datasets.push({ id: 'csv', kind: 'csv', input: csv.ref, selection: 'random' },
      { id: 'json', kind: 'json', input: json.ref, selection: 'random' });
    const value = compiled(config, dependencies([csv, json]));
    expect(value.datasets[2]?.rows).toHaveLength(10_000); expect(value.datasets[3]?.rows).toHaveLength(10_000);
  });
  it('rejects >10000 rows, >64 columns, oversized cells and total materialized cells', () => {
    const contents = ['a\n' + 'x\n'.repeat(10_001), Array.from({ length: 65 }, (_, i) => 'c' + i).join(',') + '\n' + 'x,'.repeat(64) + 'x',
      'a\n' + 'x'.repeat(4097), JSON.stringify(Array.from({ length: 10001 }, () => ({ a: 1 }))),
      Array.from({ length: 26 }, (_, i) => 'c' + i).join(',') + '\n' + Array.from({ length: 10000 }, () => 'x,'.repeat(25) + 'x').join('\n')];
    for (const content of contents) {
      const item = input(content); const config = fixture(); config.datasets.push({ id: 'bad', kind: content[0] === '[' ? 'json' : 'csv', input: item.ref, selection: 'random' });
      expect(validateAndCompileSuite(config, dependencies([item])).ok).toBe(false);
    }
  });
  it('enforces aggregate dataset cell budget and bounded range before materialization', () => {
    const content = Array.from({ length: 16 }, (_, i) => 'c' + i).join(',') + '\n'
      + Array.from({ length: 8000 }, () => 'x,'.repeat(15) + 'x').join('\n');
    const first = input(content); const second = input(content, 2); const config = fixture();
    config.datasets.push({ id: 'csv1', kind: 'csv', input: first.ref, selection: 'random' },
      { id: 'csv2', kind: 'csv', input: second.ref, selection: 'random' });
    expect(validateAndCompileSuite(config, dependencies([first, second])).ok).toBe(false);
    config.datasets = [{ id: 'numbers', kind: 'range', selection: 'byVu', column: 'value', start: 1, end: 10001, step: 1 }];
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
  it('rejects invalid dataset selection coordinates and injected samples', () => {
    const datasets = compiled().datasets;
    for (const random of [() => NaN, () => -0.1, () => 1]) expect(selectDatasetRows(datasets, { vu: 1, iteration: 0 }, random).ok).toBe(false);
    expect(selectDatasetRows(datasets, { vu: 0, iteration: 0 }, () => 0).ok).toBe(false);
    expect(selectDatasetRows(datasets, { vu: 1, iteration: -1 }, () => 0).ok).toBe(false);
  });
});
