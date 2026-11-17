/**
 * Records the current anchor hashes on the named `docs/system/` pages.
 * Running it states that you reread each page against its anchored code (decision 017).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { anchorHash, parseAnchors } from './doc-anchors.js';

const files = process.argv.slice(2);
if (!files.length) throw new Error('usage: npm run docs:stamp -- docs/system/<page>.md ...');
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  const anchors = parseAnchors(lines.join('\n'));
  if (!anchors?.length) throw new Error(`${file}: no "## Anchors" table`);
  for (const anchor of anchors) {
    const hash = await anchorHash(anchor.path);
    if (!hash) throw new Error(`${file}:${anchor.line}: anchor ${anchor.path} does not exist`);
    lines[anchor.line - 1] = `| \`${anchor.path}\` | \`${hash}\` |`;
  }
  await writeFile(file, lines.join('\n'));
  console.log(`Stamped ${anchors.length} anchors in ${file}.`);
}
