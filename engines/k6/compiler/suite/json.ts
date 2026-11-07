import { fail } from './failure.js';
import { suiteLimits, unsafeNames } from './limits.js';
interface Scanner {
  nodes: number; quoted: boolean; escaped: boolean; stringChars: number; cells: number;
  expectValue: boolean; datasetCells: number | undefined; collections: { kind: string; separators: number }[];
}
function quoted(state: Scanner, char: string): void {
  if (++state.stringChars > suiteLimits.cellChars * 6 + 2) fail('input_limit');
  if (state.escaped) state.escaped = false;
  else if (char === '\\') state.escaped = true;
  else if (char === '"') state.quoted = false;
}
function objectProperty(state: Scanner, container: { separators: number }): void {
  const maximum = state.datasetCells === undefined ? 4096 : suiteLimits.columns;
  if (++container.separators > maximum) fail('input_limit');
  if (++state.cells > (state.datasetCells ?? Infinity)) fail('input_limit');
}
function arraySeparator(state: Scanner, container: { separators: number }): void {
  const maximum = state.datasetCells !== undefined && state.collections.length === 1 ? suiteLimits.rows : 4096;
  if (++container.separators >= maximum) fail('input_limit');
}
function separator(state: Scanner, char: string): void {
  const container = state.collections.at(-1);
  if (!container) return;
  if (char === ':' && container.kind === '{') objectProperty(state, container);
  if (char === ',' && container.kind === '[') arraySeparator(state, container);
}
function structural(state: Scanner, char: string): void {
  switch (char) {
    case '"': state.quoted = true; state.stringChars = 0; break;
    case '[': case '{':
      state.collections.push({ kind: char, separators: 0 }); state.expectValue = char === '['; break;
    case ']': case '}': state.collections.pop(); state.expectValue = false; break;
    case ',': case ':':
      separator(state, char); state.expectValue = char === ':' || state.collections.at(-1)?.kind === '['; break;
  }
}
function scan(state: Scanner, char: string): void {
  if (state.quoted) { quoted(state, char); return; }
  // A value begins at its first non-whitespace character, including container roots.
  // Object keys never set expectValue; primitive continuations and separators add no nodes.
  if (state.expectValue && !/[\s,\]}:]/.test(char)) { state.nodes++; state.expectValue = false; }
  structural(state, char);
}
/** Linear preflight caps nesting, collections, cells, strings and JSON value nodes before parsing. */
export function parseInputJson(text: string, maximumNodes: number = suiteLimits.jsonNodes, datasetCells?: number): unknown {
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1) fail('input_limit');
  const state: Scanner = { nodes: 0, quoted: false, escaped: false, stringChars: 0, cells: 0,
    expectValue: true, datasetCells, collections: [] };
  for (const char of text) {
    scan(state, char);
    if (state.collections.length > suiteLimits.jsonDepth || state.nodes > maximumNodes) fail('input_limit');
  }
  try { return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown; }
  catch { return fail('invalid_json'); }
}
export function scalar(value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= suiteLimits.cellChars;
  return typeof value === 'number' && Number.isFinite(value);
}
export function safeObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => !unsafeNames.has(key));
}
