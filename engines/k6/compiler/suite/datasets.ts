import { parseCsv } from './csv.js';
import { fail } from './failure.js';
import { parseInputJson, safeObject, scalar } from './json.js';
import { identifier, suiteLimits, unsafeNames } from './limits.js';
import { reserveExpansion } from './resources.js';
import type { ExpansionBudget } from './resources.js';
import type { DatasetPlan, DeepReadonly, DatasetConfig, Row } from './types.js';
export interface CellBudget { cells: number }
function reserve(budget: CellBudget, cells: number): void {
  if (budget.cells + cells > suiteLimits.cells) fail('input_limit', '/datasets');
  budget.cells += cells;
}
function columnNames(columns: string[]): void {
  if (!columns.length || columns.length > suiteLimits.columns || new Set(columns).size !== columns.length
    || columns.some(column => !identifier.test(column) || unsafeNames.has(column))) fail('dataset', '/datasets');
}
function validateRow(row: unknown, columns: string[]): asserts row is Record<string, unknown> {
  if (!safeObject(row) || Object.keys(row).length !== columns.length) fail('dataset', '/datasets');
}
function rowsFromJson(value: unknown, budget: CellBudget): { columns: string[]; rows: Row[] } {
  if (!Array.isArray(value) || !value.length || value.length > suiteLimits.rows) fail('dataset', '/datasets');
  if (!safeObject(value[0])) fail('dataset', '/datasets');
  const columns = Object.keys(value[0]).sort();
  columnNames(columns); reserve(budget, value.length * columns.length);
  const rows: Row[] = [];
  for (const row of value) {
    validateRow(row, columns);
    const output: Record<string, string | number | boolean | null> = Object.create(null) as Record<string, string | number | boolean | null>;
    for (const column of columns) {
      if (!Object.hasOwn(row, column) || !scalar(row[column])) fail('dataset', '/datasets');
      output[column] = row[column];
    }
    rows.push(output);
  }
  return { columns, rows };
}
function rowsFromCsv(text: string, budget: CellBudget): { columns: string[]; rows: Row[] } {
  const table = parseCsv(text, suiteLimits.cells - budget.cells + suiteLimits.columns);
  const columns = table.shift() ?? [];
  columnNames(columns);
  if (!table.length) fail('dataset', '/datasets');
  reserve(budget, table.length * columns.length);
  const rows = table.map(row => {
    if (row.length !== columns.length) fail('csv', '/datasets');
    return Object.fromEntries(columns.map((name, index) => [name, row[index]!])) as Row;
  });
  return { columns, rows };
}
function range(dataset: Extract<DatasetConfig, { kind: 'range' }>, budget: CellBudget): { columns: string[]; rows: Row[] } {
  const count = Math.floor((dataset.end - dataset.start) / dataset.step) + 1;
  if (count < 1 || count > suiteLimits.rows) fail('dataset', '/datasets');
  columnNames([dataset.column]); reserve(budget, count);
  return { columns: [dataset.column], rows: Array.from({ length: count }, (_, index) => ({
    [dataset.column]: dataset.start + index * dataset.step,
  })) };
}
export function compileDatasets(datasets: DeepReadonly<DatasetConfig[]>, inputs: ReadonlyMap<string, string>, expansion: ExpansionBudget): DatasetPlan[] {
  const budget: CellBudget = { cells: 0 };
  return datasets.map(dataset => {
    if ('input' in dataset) reserveExpansion(expansion, dataset.input.bytes);
    let data: { columns: string[]; rows: Row[] };
    if (dataset.kind === 'range') data = range(dataset, budget);
    else if (dataset.kind === 'inline') data = rowsFromJson(dataset.rows, budget);
    else if (dataset.kind === 'csv') data = rowsFromCsv(inputs.get(dataset.input.id)!, budget);
    else data = rowsFromJson(parseInputJson(inputs.get(dataset.input.id)!, suiteLimits.cells * 4, suiteLimits.cells - budget.cells), budget);
    return { id: dataset.id, selection: dataset.selection, ...data };
  });
}
