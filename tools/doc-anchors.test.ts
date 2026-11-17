import { expect, it } from 'vitest';
import { anchorHash, anchorIssues, parseAnchors } from './doc-anchors.js';

const page = (reviewed: string) =>
  ['# Page', '', '## Anchors', '', '| Code | Reviewed |', '| --- | --- |', `| \`tools/doc-anchors.ts\` | \`${reviewed}\` |`].join('\n');

it('parses the anchors table and ignores other sections', () => {
  expect(parseAnchors('# Page\n\nNo table.')).toBeUndefined();
  expect(parseAnchors(page('unstamped'))).toEqual([{ path: 'tools/doc-anchors.ts', reviewed: 'unstamped', line: 7 }]);
});
it('accepts a current stamp and rejects stale, unstamped or missing anchors', async () => {
  const hash = await anchorHash('tools/doc-anchors.ts');
  expect(await anchorIssues('docs/system/x.md', page(hash!))).toEqual([]);
  expect(await anchorIssues('docs/system/x.md', page('unstamped'))).toHaveLength(1);
  expect(await anchorIssues('docs/system/x.md', page('000000000000'))).toHaveLength(1);
  expect(await anchorIssues('docs/system/x.md', page(hash!).replace('doc-anchors.ts', 'gone.ts'))).toHaveLength(1);
});
it('requires anchors only on system pages other than READMEs', async () => {
  expect(await anchorIssues('docs/system/x.md', '# No anchors')).toHaveLength(1);
  expect(await anchorIssues('docs/system/README.md', '# Map')).toEqual([]);
  expect(await anchorIssues('docs/guides/x.md', '# Guide')).toEqual([]);
});
it('hashes directories without their tests', async () => {
  expect(await anchorHash('tools')).toMatch(/^[0-9a-f]{12}$/);
  expect(await anchorHash('does/not/exist')).toBeUndefined();
});
