import { readFile } from 'node:fs/promises';
import { sitePageIssues } from './site-docs.js';
import { sourceFiles } from './source-files.js';

const files = await sourceFiles('site/src/content', /\.mdx?$/);
const failures = (
  await Promise.all(files.map(async (file) => sitePageIssues(file, await readFile(file, 'utf8'))))
).flat();
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Checked ${files.length} site pages.`);
