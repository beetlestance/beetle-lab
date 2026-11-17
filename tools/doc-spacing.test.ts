import { expect, it } from 'vitest';
import { proseSpacingIssues } from './doc-spacing.js';
it('separates the reported prose defects, metrics and human-readable units', () => {
  const text = 'Node.js24.12 passes1491ms every100ms; current AMD long p95193.16ms, base733b49cc. At most1,801 reads.';
  expect(proseSpacingIssues(text)).toEqual([
    {
      line: 1,
      replacement:
        'Node.js 24.12 passes 1491 ms every 100 ms; current AMD long p95 193.16 ms, base 733b49cc. At most 1,801 reads.',
    },
  ]);
});
it('preserves code fences, inline code, links, URLs, hashes, identifiers and valid numbers', () => {
  const text = [
    '```ts',
    'every100ms Node.js24.12',
    '```',
    '~~~sh',
    'every100ms',
    '~~~',
    '    every100ms',
    '`every100ms` ``Node.js24.12`` [guide](path/every100ms.md)',
    'https://example.test/every100ms base64 ARM64 v1 p95 p99.9 sha256:733b49cc 2026-11-17',
  ].join('\n');
  expect(proseSpacingIssues(text)).toEqual([]);
});
it('checks link labels and adjacent prose while preserving destinations', () => {
  expect(proseSpacingIssues('[passes1491ms](path/every100ms.md) every100ms')).toEqual([
    { line: 1, replacement: '[passes 1491 ms](path/every100ms.md) every 100 ms' },
  ]);
});
it('separates any word glued to a measured quantity', () => {
  const text = 'SQLite cache2MiB/busy100ms; startup5s, then5s; frame64KiB with100ms.';
  expect(proseSpacingIssues(text)).toEqual([
    { line: 1, replacement: 'SQLite cache 2 MiB/busy 100 ms; startup 5 s, then 5 s; frame 64 KiB with 100 ms.' },
  ]);
});
it('leaves status codes, encodings and architectures alone', () => {
  expect(proseSpacingIssues('Old 404s, base64, sha256, amd64 and arm64 stay as written.')).toEqual([]);
  expect(proseSpacingIssues('old404s stay; HTTP2 too.')).toEqual([]);
});
it('leaves commit hashes that start with a prose word alone', () => {
  expect(proseSpacingIssues('Measured at a646d39a and at40c4a5c1 drift.')).toEqual([
    { line: 1, replacement: 'Measured at a646d39a and at 40c4a5c1 drift.' },
  ]);
});
it('does not change an already corrected paragraph', () => {
  expect(proseSpacingIssues('Node.js 24.12 passes 1491 ms every 100 ms; p95 193.16 ms, base 733b49cc.')).toEqual([]);
});
