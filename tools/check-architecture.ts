import { readFile } from 'node:fs/promises';
import { resolveLocalImport } from './module-resolution.js';
import { sourceFiles } from './source-files.js';
import { importTargets, boundaryIssues, findCycle } from './architecture.js';
const roots = ['app', 'agent', 'contracts', 'web/src', 'engines/k6', 'tools'];
const files = (await Promise.all(roots.map(root => sourceFiles(root)))).flat();
const known = new Set(files);
const edges = new Map<string, string[]>();
const failures: string[] = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const max = file.includes('.test.') ? 500 : 400;
  if (text.split('\n').length > max + 1) failures.push(`${file}: over ${max} lines`);
  const targets = importTargets(text);
  failures.push(...boundaryIssues(file, targets).map(issue => `${issue.file}: ${issue.reason}`));
  const local = targets.map(target => resolveLocalImport(file, target, known));
  edges.set(file, local.filter((target): target is string => target !== undefined));
}
const cycle = findCycle(edges);
if (cycle) failures.push(`Import cycle: ${cycle.join(' -> ')}`);
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Checked ${files.length} source files for boundaries, cycles and size.`);
