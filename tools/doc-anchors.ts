import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { sourceFiles } from './source-files.js';

/** One row of a `## Anchors` table on a `docs/system/` page (decision 017). */
export interface Anchor {
  readonly path: string;
  readonly reviewed: string;
  readonly line: number;
}
const anchorRow = /^\|\s*`([^`]+)`\s*\|\s*`?([0-9a-f]{12}|unstamped)`?\s*\|\s*$/;

export function parseAnchors(text: string): readonly Anchor[] | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Anchors');
  if (start < 0) return undefined;
  const anchors: Anchor[] = [];
  for (let index = start + 1; index < lines.length && !lines[index]!.startsWith('## '); index++) {
    const match = anchorRow.exec(lines[index]!);
    if (match) anchors.push({ path: match[1]!, reviewed: match[2]!, line: index + 1 });
  }
  return anchors;
}

export function needsAnchors(file: string): boolean {
  return file.startsWith('docs/system/') && !file.endsWith('/README.md');
}

/** Content hash of the anchored code, excluding tests, so test-only edits do not demand a reread. */
export async function anchorHash(path: string): Promise<string | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return undefined;
  const files = info.isDirectory() ? (await sourceFiles(path, /./)).filter((file) => !/\.test\./.test(file)) : [path];
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file}\0`).update(await readFile(file)).update('\0');
  return hash.digest('hex').slice(0, 12);
}

export async function anchorIssues(file: string, text: string): Promise<readonly string[]> {
  if (!needsAnchors(file)) return [];
  const anchors = parseAnchors(text);
  if (!anchors?.length) return [`${file}: system/ pages need an "## Anchors" table naming the code they describe`];
  const issues: string[] = [];
  for (const anchor of anchors) {
    const actual = await anchorHash(anchor.path);
    if (!actual) issues.push(`${file}:${anchor.line}: anchor ${anchor.path} does not exist`);
    else if (actual !== anchor.reviewed)
      issues.push(`${file}:${anchor.line}: ${anchor.path} changed since review; reread the page, then run npm run docs:stamp -- ${file}`);
  }
  return issues;
}
