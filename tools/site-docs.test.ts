import { expect, it } from 'vitest';
import { SITE_PAGE_LINE_LIMIT, sitePageIssues } from './site-docs.js';

const page = (body: string) => `---\ntitle: Runs\ndescription: What a run is.\n---\n\n${body}\n`;

it('accepts a page with frontmatter, spaced prose, MDX imports and pinned links', () => {
  const body = [
    "import RunReplay from '../../../components/RunReplay.astro';",
    'Each run waits 5 s at most.',
    '<RunReplay />',
    '[schemas](https://github.com/o/r/tree/5b8e016c/contracts/api/v2)',
  ].join('\n');
  expect(sitePageIssues('site/a.mdx', page(body))).toEqual([]);
});

it('reports prose spacing, length, frontmatter and links on a moving branch', () => {
  const long = Array.from({ length: SITE_PAGE_LINE_LIMIT }, () => 'line').join('\n');
  const text = `---\ntitle: Runs\n---\nwaits every100ms\n[x](https://github.com/o/r/blob/main/a.json)\n${long}`;
  expect(sitePageIssues('site/b.md', text)).toEqual([
    'site/b.md:4: missing space in prose word/number or unit',
    `site/b.md: over ${SITE_PAGE_LINE_LIMIT} lines`,
    'site/b.md: frontmatter needs a description',
    "site/b.md: GitHub link on main; pin it to a revision or use the app's reference downloads",
  ]);
  expect(sitePageIssues('site/c.md', 'no frontmatter')).toEqual(['site/c.md: missing frontmatter']);
});
