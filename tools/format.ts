import { readFile, writeFile } from 'node:fs/promises';
import { check, format, resolveConfig } from 'prettier';
import scope from '../.source-format.json' with { type: 'json' };
import { sourceFiles } from './source-files.js';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--check', '--write'].includes(args[0]!)) throw Error('Use --check or --write');
const write = args[0] === '--write';
const ignored = new Set(scope.nonProductionSegments);
function authored(input: string): boolean {
  const file = input.replaceAll('\\', '/');
  return (
    !scope.generated.some((root) => file.startsWith(root)) &&
    !file.split('/').some((part) => ignored.has(part)) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}
const discovered = (await Promise.all(scope.roots.map((root) => sourceFiles(root)))).flat();
const files = [...new Set([...discovered.filter(authored), ...scope.configFiles])].sort();
const options = (await resolveConfig('package.json')) ?? {};
const changed: string[] = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const settings = { ...options, filepath: file };
  if (await check(source, settings)) continue;
  changed.push(file);
  if (write) await writeFile(file, await format(source, settings));
}
console.log(
  `Checked ${files.length} authored production/tooling files; ${changed.length} ${write ? 'formatted' : 'need formatting'}.`,
);
if (!write && changed.length) {
  console.error(changed.slice(0, 20).join('\n'));
  if (changed.length > 20) console.error(`... and ${changed.length - 20} more; run npm run format.`);
  process.exitCode = 1;
}
