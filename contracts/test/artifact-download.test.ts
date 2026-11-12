import { expect, it } from 'vitest';
import { artifactDownload } from '../src/index.js';
const artifactId = '44444444-4444-4444-8444-444444444444';
it.each([
  ['performance-report', 'text/plain; charset=utf-8', 'txt'],
  ['metrics-csv', 'text/csv; charset=utf-8', 'csv'],
  ['numeric-final', 'application/json; charset=utf-8', 'json'],
  ['raw', 'application/octet-stream', 'bin'],
  ['text/html\r\ninjected', 'application/octet-stream', 'bin'],
  ['__proto__', 'application/octet-stream', 'bin'],
])('uses a fixed format/attachment name for %s', (kind, contentType, extension) => {
  expect(artifactDownload({artifactId, kind})).toEqual({contentType, extension, filename: `artifact-${artifactId}.${extension}`});
});
it('rejects unvalidated identifiers rather than creating header/path text', () => {
  for (const id of ['../secret', 'x\r\nHeader: value', '', '"bad"']) {
    expect(() => artifactDownload({artifactId: id, kind: 'performance-report'})).toThrow('Invalid artifact ID');
  }
});
