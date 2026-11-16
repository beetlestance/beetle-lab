import { open } from 'node:fs/promises';

const maxDataBytes = 24 * 1_048_576;
// Public JSON depth32 expands by at most3 (entries/index/value) per object level.
// Root -> requests/index/body/value adds4; template/tokens/index/value adds4.
const maxDataDepth = 32 * 3 + 8;
interface Budget { nodes: number; ancestors: Set<object> }
const controlEscapes: Readonly<Record<number,string>> = {8:'\\b',9:'\\t',10:'\\n',12:'\\f',13:'\\r'};
function escapedUnit(code: number): string {
  return controlEscapes[code] ?? '\\u'+code.toString(16).padStart(4,'0');
}
function escaped(value: string, index: number): { text: string; width: number } {
  const code = value.charCodeAt(index);const char = value[index]!;
  if (char === '"' || char === '\\') return { text: '\\'+char, width: 1 };
  if (code < 32) return { text: escapedUnit(code), width: 1 };
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index+1);
    if (next >= 0xdc00 && next <= 0xdfff) return { text: value.slice(index,index+2), width: 2 };
  }
  if (code >= 0xd800 && code <= 0xdfff) return { text: escapedUnit(code), width: 1 };
  return { text: char, width: 1 };
}
function* stringTokens(value: string, literalBody = false): Generator<string> {
  const limit = literalBody ? 8388608 : 6 * 65536;
  if (value.length > (literalBody ? 8388608 : 65536)) throw new Error('script_limit');
  yield '"';let pending = '';let bytes = 0;
  for (let index = 0; index < value.length;) {
    const part = escaped(value,index);pending += part.text;index += part.width;
    if (pending.length < 16384) continue;
    bytes += Buffer.byteLength(pending);if (bytes > limit) throw new Error('script_limit');
    yield pending;pending = '';
  }
  bytes += Buffer.byteLength(pending);if (bytes > limit) throw new Error('script_limit');
  if (pending) yield pending;yield '"';
}
function primitive(value: unknown): string {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new Error('script_data');
}
function literalBodyField(value: object, key: string): boolean {
  const node = value as Record<string,unknown>;
  return key === 'value' && node.kind === 'scalar' || key === 'literal' && node.kind === 'input' && node.format === 'text';
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
    if (key.length > 65536) throw new Error('script_limit');
    yield separator; yield* stringTokens(key); yield ':'; yield* tokens(item, budget, depth + 1, literalBodyField(value,key)); separator = ',';
  }
  yield '}';
}
function* tokens(value: unknown, budget: Budget, depth = 0, literalBody = false): Generator<string> {
  if (++budget.nodes > 2_000_000 || depth > maxDataDepth) throw new Error('script_limit');
  if (typeof value === 'string') { yield* stringTokens(value,literalBody); return; }
  if (value === null || typeof value !== 'object') { yield primitive(value); return; }
  if (budget.ancestors.has(value)) throw new Error('script_data');
  budget.ancestors.add(value);
  yield* collection(value, budget, depth);
  budget.ancestors.delete(value);
}
function chunks(value: unknown): Generator<string> { return tokens(value, { nodes: 0, ancestors: new Set() }); }
function admit(bytes: number, token: string, maximum: number): number {
  const next = bytes + Buffer.byteLength(token);
  if (next > Math.min(maxDataBytes,maximum)) throw new Error('script_limit');
  return next;
}
/** Two bounded passes, no full-corpus intermediate string or stringify-then-check. */
export async function writePlanData(path: string, value: unknown, maximumBytes = maxDataBytes): Promise<number> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('script_limit');
  let bytes = 0;
  for (const token of chunks(value)) {
    bytes = admit(bytes,token,maximumBytes);
  }
  const file = await open(path, 'wx', 0o600);
  try {
    let pending = '';let written = 0;
    for (const token of chunks(value)) {
      written = admit(written,token,maximumBytes);
      pending += token;
      if (pending.length >= 65_536) { await file.writeFile(pending); pending = ''; }
    }
    if (pending) await file.writeFile(pending);
    if (written !== bytes) throw new Error('script_data');
  } finally { await file.close(); }
  return bytes;
}
