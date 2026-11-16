import { fail } from './failure.js';
import { suiteLimits } from './limits.js';
interface CsvState { rows: string[][]; row: string[]; cell: string[]; quoted: boolean; closed: boolean; cells: number; maximumCells: number }
function pushCell(state: CsvState): void {
  if (state.row.length >= suiteLimits.columns || ++state.cells > state.maximumCells) fail('input_limit');
  state.row.push(state.cell.join('')); state.cell = []; state.closed = false;
}
function pushRow(state: CsvState): void {
  pushCell(state);
  if (state.rows.length >= suiteLimits.rows + 1) fail('input_limit');
  state.rows.push(state.row); state.row = [];
}
function append(state: CsvState, char: string): void {
  if (state.cell.length + char.length > suiteLimits.cellChars) fail('input_limit');
  state.cell.push(char);
}
function unquoted(state: CsvState, char: string): void {
  if (char === ',') pushCell(state);
  else if (char === '\n' || char === '\r') pushRow(state);
  else if (char === '"' && !state.cell.length && !state.closed) state.quoted = true;
  else {
    if (state.closed || char === '"') fail('csv');
    append(state, char);
  }
}
function quotedChar(state: CsvState, char: string, next: string | undefined): boolean {
  if (char !== '"') append(state, char);
  else if (next === '"') { append(state, '"'); return true; }
  else { state.quoted = false; state.closed = true; }
  return false;
}
function finishCsv(state: CsvState): string[][] {
  if (state.quoted) fail('csv');
  if (state.row.length || state.cell.length || state.closed) pushRow(state);
  return state.rows;
}
/** RFC4180-style strict CSV, including BOM, escaped quotes, embedded CRLF and trailing empty cells. */
export function parseCsv(text: string, maximumCells: number = suiteLimits.cells + suiteLimits.columns): string[][] {
  const state: CsvState = { rows: [], row: [], cell: [], quoted: false, closed: false, cells: 0, maximumCells };
  let index = text.startsWith('\uFEFF') ? 1 : 0;
  for (; index < text.length; index++) {
    const char = text[index]!;
    if (state.quoted) {
      if (quotedChar(state, char, text[index + 1])) index++;
    } else {
      unquoted(state, char);
      if (char === '\r' && text[index + 1] === '\n') index++;
    }
  }
  return finishCsv(state);
}
