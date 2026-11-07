import { open } from 'node:fs/promises';

const maxDataBytes = 24 * 1_048_576;
// Public JSON depth32 expands by at most3 (entries/index/value) per object level.
// Root -> requests/index/body/value adds4; template/tokens/index/value adds4.
const maxDataDepth = 32 * 3 + 8;
interface Budget { nodes: number; ancestors: Set<object> }
function scalar(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length > 65_536) throw new Error('script_limit');
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new Error('script_data');
}
function* collection(value: object, budget: Budget, depth: number): Generator<string> {
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {
      if (index) yield ',';
      yield* tokens(value[index], budget, depth + 1);
    }
    yield ']'; return;
  }
  yield '{';
  let separator = '';
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) continue;
    yield separator; yield scalar(key); yield ':'; yield* tokens(item, budget, depth + 1); separator = ',';
  }
  yield '}';
}
function* tokens(value: unknown, budget: Budget, depth = 0): Generator<string> {
  if (++budget.nodes > 2_000_000 || depth > maxDataDepth) throw new Error('script_limit');
  if (value === null || typeof value !== 'object') { yield scalar(value); return; }
  if (budget.ancestors.has(value)) throw new Error('script_data');
  budget.ancestors.add(value);
  yield* collection(value, budget, depth);
  budget.ancestors.delete(value);
}
function chunks(value: unknown): Generator<string> { return tokens(value, { nodes: 0, ancestors: new Set() }); }
/** Two bounded passes, no full-corpus intermediate string or stringify-then-check. */
export async function writePlanData(path: string, value: unknown): Promise<number> {
  let bytes = 0;
  for (const token of chunks(value)) {
    bytes += Buffer.byteLength(token);
    if (bytes > maxDataBytes) throw new Error('script_limit');
  }
  const file = await open(path, 'wx');
  try {
    let pending = '';
    for (const token of chunks(value)) {
      pending += token;
      if (pending.length >= 65_536) { await file.writeFile(pending); pending = ''; }
    }
    if (pending) await file.writeFile(pending);
  } finally { await file.close(); }
  return bytes;
}
