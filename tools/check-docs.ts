import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sourceFiles } from './source-files.js';
const files = ['PLAN.md', 'README.md', ...await sourceFiles('docs', /\.md$/)];
const failures: string[] = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const limit = file.includes('/lld/') ? 220 : 180;
  if (text.split('\n').length > limit + 1) failures.push(`${file}: over ${limit} lines`);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue;
    try { await access(resolve(dirname(file), path)); } catch { failures.push(`${file}: missing ${target}`); }
  }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Checked ${files.length} documentation files.`);
