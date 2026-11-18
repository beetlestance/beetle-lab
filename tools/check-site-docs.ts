import { readFile } from 'node:fs/promises';
import { sitePageIssues } from './site-docs.js';
import { skinDriftIssues, skinTokens } from './site-skins.js';
import { sourceFiles } from './source-files.js';

const files = await sourceFiles('site/src/content', /\.mdx?$/);
const failures = (
  await Promise.all(files.map(async (file) => sitePageIssues(file, await readFile(file, 'utf8'))))
).flat();
const app = skinTokens(await readFile('web/src/styles/tokens.css', 'utf8'));
const docs = skinTokens(await readFile('site/src/styles/skins.css', 'utf8'));
failures.push(...skinDriftIssues(app, docs).map((issue) => `site/src/styles/skins.css: ${issue}`));
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Checked ${files.length} site pages and the docs skin tokens.`);
