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
it('does not change an already corrected paragraph', () => {
  expect(proseSpacingIssues('Node.js 24.12 passes 1491 ms every 100 ms; p95 193.16 ms, base 733b49cc.')).toEqual([]);
});
