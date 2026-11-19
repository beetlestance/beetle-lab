import { readFile } from 'node:fs/promises';
import { sitePageIssues } from './site-docs.js';
import { contrastIssues, skinDriftIssues, skinTokens, undefinedTokenIssues } from './site-skins.js';
import { sourceFiles } from './source-files.js';

const files = await sourceFiles('site/src/content', /\.mdx?$/);
const failures = (
  await Promise.all(files.map(async (file) => sitePageIssues(file, await readFile(file, 'utf8'))))
).flat();
const app = skinTokens(await readFile('web/src/styles/tokens.css', 'utf8'));
const docs = skinTokens(await readFile('site/src/styles/skins.css', 'utf8'));
failures.push(...skinDriftIssues(app, docs).map((issue) => `site/src/styles/skins.css: ${issue}`));
failures.push(...contrastIssues(docs).map((issue) => `site/src/styles/skins.css: ${issue}`));
const styles = await sourceFiles('site/src', /\.(css|astro|mdx?)$/);
const sources = new Map(await Promise.all(styles.map(async (file) => [file, await readFile(file, 'utf8')] as const)));
failures.push(...undefinedTokenIssues(sources));
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  `Checked ${files.length} site pages, the docs skin tokens, their text contrast and ${styles.length} style sources.`,
);
