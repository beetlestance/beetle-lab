/** One line of a two-way diff; `left`/`right` are 1-based line numbers on each side. */
export type DiffLine =
  | { kind: 'same'; text: string; left: number; right: number }
  | { kind: 'del'; text: string; left: number }
  | { kind: 'add'; text: string; right: number };
export type Diff = { lines: DiffLine[]; added: number; removed: number };
/** A run of the diff to render: changed or nearby lines, or a fold of unchanged ones. */
export type Hunk = { kind: 'lines'; lines: DiffLine[] } | { kind: 'fold'; lines: DiffLine[] };

/** Largest product of line counts diffed in the browser (an LCS table of this many cells). */
export const maximumDiffCells = 4_000_000;

function table(a: readonly string[], b: readonly string[]): Uint32Array {
  const width = b.length + 1;
  const cells = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      cells[i * width + j] =
        a[i] === b[j]
          ? cells[(i + 1) * width + j + 1]! + 1
          : Math.max(cells[(i + 1) * width + j]!, cells[i * width + j + 1]!);
  return cells;
}

/** Line diff from `before` to `after` by longest common subsequence; null when too large to diff here. */
export function lineDiff(before: string, after: string): Diff | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if ((a.length + 1) * (b.length + 1) > maximumDiffCells) return null;
  const cells = table(a, b);
  const width = b.length + 1;
  const lines: DiffLine[] = [];
  let [i, j, added, removed] = [0, 0, 0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]!, left: ++i, right: ++j });
    } else if (i < a.length && (j === b.length || cells[(i + 1) * width + j]! >= cells[i * width + j + 1]!)) {
      lines.push({ kind: 'del', text: a[i]!, left: ++i });
      removed++;
    } else {
      lines.push({ kind: 'add', text: b[j]!, right: ++j });
      added++;
    }
  }
  return { lines, added, removed };
}

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs. */
export function hunks(lines: readonly DiffLine[], context = 3): Hunk[] {
  const result: Hunk[] = [];
  let start = 0;
  const flush = (end: number) => end > start && result.push({ kind: 'lines', lines: lines.slice(start, end) });
  for (let index = 0; index < lines.length;) {
    if (lines[index]!.kind !== 'same') {
      index++;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end]!.kind === 'same') end++;
    const head = index === 0 ? 0 : context;
    const tail = end === lines.length ? 0 : context;
    if (end - index > head + tail + 1) {
      flush(index + head);
      result.push({ kind: 'fold', lines: lines.slice(index + head, end - tail) });
      start = end - tail;
    }
    index = end;
  }
  flush(lines.length);
  return result;
}

/** Pairs deletions with additions row by row for the side-by-side view. */
export function sideBySide(lines: readonly DiffLine[]): [DiffLine | null, DiffLine | null][] {
  const rows: [DiffLine | null, DiffLine | null][] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(dels.length, adds.length); index++)
      rows.push([dels[index] ?? null, adds[index] ?? null]);
    dels = [];
    adds = [];
  };
  for (const line of lines) {
    if (line.kind === 'del') dels.push(line);
    else if (line.kind === 'add') adds.push(line);
    else {
      flush();
      rows.push([line, line]);
    }
  }
  flush();
  return rows;
}
