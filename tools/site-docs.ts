import { proseSpacingIssues } from './doc-spacing.js';

/** Rules for user pages in site/src/content (.md and .mdx), checked by check:site-docs. */
export const SITE_PAGE_LINE_LIMIT = 180;

const frontmatter = (text: string): string | undefined => /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)?.[1];

/** Returns one message per problem; an empty list means the page passes. */
export function sitePageIssues(file: string, text: string): string[] {
  const issues: string[] = [];
  for (const issue of proseSpacingIssues(text))
    issues.push(`${file}:${issue.line}: missing space in prose word/number or unit`);
  if (text.split('\n').length > SITE_PAGE_LINE_LIMIT + 1) issues.push(`${file}: over ${SITE_PAGE_LINE_LIMIT} lines`);
  const head = frontmatter(text);
  if (head === undefined) issues.push(`${file}: missing frontmatter`);
  else
    for (const key of ['title', 'description'])
      if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(head)) issues.push(`${file}: frontmatter needs a ${key}`);
  // Repository files linked from user pages must resolve on a stated revision, not on a moving branch.
  for (const match of text.matchAll(/github\.com\/[^\s)]+\/(?:blob|tree)\/(main|develop)\//g))
    issues.push(`${file}: GitHub link on ${match[1]}; pin it to a revision or use the app's reference downloads`);
  return issues;
}
