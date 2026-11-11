import { expect, it } from 'vitest';
import { inputManifest } from '../../src/domain/suites/index.js';
const pin = { id: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF', sha256: 'a'.repeat(64), bytes: 0 };
it('derives only actual input variants, normalizes UUIDs and deduplicates exact pins', () => {
  expect(inputManifest({ datasets: [{ kind: 'inline', rows: [] }, { kind: 'range' },
    { kind: 'csv', input: pin }, { kind: 'json', input: { ...pin, id: pin.id.toLowerCase() } }] }))
    .toEqual([{ ...pin, id: pin.id.toLowerCase() }]);
});
it('rejects conflicting same-ID pins and bounds the manifest', () => {
  expect(() => inputManifest({ datasets: [{ kind: 'json', input: pin }, { kind: 'csv', input: { ...pin, bytes: 1 } }] })).toThrow();
  const datasets = Array.from({ length: 800 }, (_, i) => ({ kind: 'json', input: { ...pin,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` } }));
  expect(() => inputManifest({ datasets })).toThrow();
});

it('pins body inputs with dataset inputs and rejects conflicts across both sources', () => {
  const body = { kind: 'input', format: 'json', input: pin };
  expect(inputManifest({ datasets: [], requests: [{ body }] })).toEqual([{ ...pin, id: pin.id.toLowerCase() }]);
  expect(inputManifest({ datasets: [{ kind: 'json', input: pin }], requests: [{ body }] })).toHaveLength(1);
  expect(() => inputManifest({ datasets: [{ kind: 'csv', input: pin }],
    requests: [{ body: { ...body, input: { ...pin, sha256: 'b'.repeat(64) } } }] })).toThrow();
});
it('keeps the combined input reference ceiling at64', () => {
  const requests = Array.from({ length: 64 }, (_, i) => ({ body: { kind: 'input', input: { ...pin,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` } } }));
  expect(inputManifest({ datasets: [], requests })).toHaveLength(64);
  expect(() => inputManifest({ datasets: [{ kind: 'json', input: pin }], requests })).toThrow();
});
