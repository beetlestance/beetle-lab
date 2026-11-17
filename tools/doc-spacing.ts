const proseWords = [
  'after',
  'before',
  'within',
  'under',
  'over',
  'through',
  'from',
  'every',
  'passes',
  'passed',
  'pass',
  'takes',
  'took',
  'at',
  'most',
  'least',
  'cap',
  'limit',
  'total',
  'only',
  'version',
  'generation',
  'phase',
  'step',
  'case',
  'run',
  'attempt',
  'test',
  'tests',
  'source',
  'fixture',
  'copies',
  'workers',
  'minutes',
  'seconds',
  'Node',
  'policy',
  'fixed',
  'plus',
  'depth',
  'mode',
  'PID',
  'existing',
  'offset',
  'UID',
  'GID',
  'outer',
  'a',
  'Journal',
  'migration',
  'interval',
  'exit',
  'protocol',
  'files',
  'generic',
  'nodes',
  'API',
  'config',
  'global',
  'max',
  'min',
  'count',
  'per',
  'duration',
  'budget',
  'schema',
  'status',
  'queue',
  'window',
  'page',
  'exact',
  'coldcheck',
];
const wordBeforeNumber = new RegExp(`\\b(${proseWords.join('|')})(?=\\d)`, 'gi');
/** Prose-only spacing checks. Code, URLs and Markdown destinations are preserved. */
function spaceProse(text: string): string {
  return text
    .replace(/\bNode\.js(?=\d)/g, 'Node.js ')
    .replace(/\bp(99\.9|99|95|90|50)(?=\d)/g, 'p$1 ')
    .replace(/\b(base|based)(?=[a-f\d]{7,40}\b)/gi, '$1 ')
    .replace(wordBeforeNumber, '$1 ')
    .replace(/\b(\d[\d,]*(?:\.\d+)?)(ms|s|KiB|MiB|GiB|TiB|bytes|seconds|minutes|hours|PIDs|VUs)\b/g, '$1 $2');
}
function lineSpacing(line: string): string {
  const protectedSpan = /(`+).*?\1|\]\([^)]*\)|https?:\/\/[^\s<>]+/g;
  let cursor = 0;
  let result = '';
  for (const match of line.matchAll(protectedSpan)) {
    result += spaceProse(line.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return result + spaceProse(line.slice(cursor));
}
export interface ProseSpacingIssue {
  readonly line: number;
  readonly replacement: string;
}
export function proseSpacingIssues(text: string): readonly ProseSpacingIssue[] {
  const issues: ProseSpacingIssue[] = [];
  let fence: { character: string; length: number } | undefined;
  for (const [index, line] of text.split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0]!, length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || /^( {4}|\t)/.test(line)) continue;
    const replacement = lineSpacing(line);
    if (replacement !== line) issues.push({ line: index + 1, replacement });
  }
  return issues;
}
