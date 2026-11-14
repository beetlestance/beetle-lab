// @vitest-environment jsdom
import {expect, it} from 'vitest';
import {planDirectory} from './plan.js';
export function selected(path: string, size = 3): File {
  const file = new File([new Uint8Array(size)], path.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', {value: path}); return file;
}
it('captures a sorted tree without reading content and keeps the chosen root', () => {
  const b = selected('data/nested/b.csv'); const a = selected('data/a.csv', 0);
  Object.defineProperty(b, 'arrayBuffer', {value: () => {throw new Error('Content must not be read in preview');}});
  const plan = planDirectory([b, a]);
  expect(plan.files.map(file => file.path)).toEqual(['data/a.csv', 'data/nested/b.csv']);
  expect(plan.files[1]!.folders).toEqual(['data', 'nested']); expect(plan.bytes).toBe(3); expect(plan.folders).toBe(2);
  expect(Object.isFrozen(plan.files)).toBe(true);
});
it.each(['data/../a', '/data/a', 'data//a', 'data/ a', 'data/dir\\bad/a', 'data/./a', 'data/\u0000a'])('rejects unsafe path %s', path => {
  expect(() => planDirectory([selected(path)])).toThrow();
});
it.each([
  ['data/a', 'data/A'], ['data/A/a', 'data/a/b'], ['data/a', 'data/a/b'], ['data/a', 'other/b'], ['data/Ｋ/a', 'data/K/b'],
])('rejects folded aliases, file/directory collisions and mixed roots: %s', (a, b) => {
  expect(() => planDirectory([selected(a), selected(b)])).toThrow();
});
it('bounds counts before copying and sizes before content preparation', () => {
  expect(() => planDirectory({length: 129})).toThrow(/128 files/);
  expect(() => planDirectory([])).toThrow(/128 files/);
  const oversized = selected('data/a'); Object.defineProperty(oversized, 'size', {value: 8388609});
  expect(() => planDirectory([oversized])).toThrow(/8 MiB/);
  expect(() => planDirectory([selected('a/b/c/d/e/f/g/h/i/file')])).toThrow(/eight/);
  const tooMuch = Array.from({length: 17}, (_, i) => {const f = selected('data/' + i); Object.defineProperty(f, 'size', {value: 8388608}); return f;});
  expect(() => planDirectory(tooMuch)).toThrow(/128 MiB/);
});
it('bounds folder metadata and rejects a missing browser-relative path', () => {
  const many = Array.from({length: 128}, (_, i) => selected('data/' + i + '/a'));
  expect(() => planDirectory(many)).toThrow(/metadata/);
  expect(() => planDirectory([new File(['x'], 'a')])).toThrow();
});
