interface EncoderState { bytes: number; nodes: number; maximum: number; parts: string[]; ancestors: Set<object> }
const utf8 = new TextEncoder();

function append(state: EncoderState, part: string): void {
  state.bytes += utf8.encode(part).byteLength;
  if (state.bytes > state.maximum) throw new Error('request_limit');
  state.parts.push(part);
}
function scalar(state: EncoderState, value: unknown): void {
  if (typeof value === 'string' && value.length > state.maximum) throw new Error('request_limit');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('invalid_json');
  if (value !== null && !['boolean', 'number', 'string'].includes(typeof value)) throw new Error('invalid_json');
  append(state, JSON.stringify(value));
}
function object(state: EncoderState, value: object, depth: number): void {
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) throw new Error('invalid_json');
  append(state, '{');
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++count > 4096 || key.length > state.maximum) throw new Error('request_limit');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('invalid_json');
    if (count > 1) append(state, ',');
    append(state, JSON.stringify(key)); append(state, ':');
    visit(state, descriptor.value, depth + 1);
  }
  append(state, '}');
}
function array(state: EncoderState, value: unknown[], depth: number): void {
  if (value.length > 4096) throw new Error('request_limit');
  append(state, '[');
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new Error('invalid_json');
    if (index) append(state, ',');
    visit(state, value[index], depth + 1);
  }
  append(state, ']');
}
function visit(state: EncoderState, value: unknown, depth: number): void {
  if (depth > 64 || ++state.nodes > Math.min(state.maximum, 65_536)) throw new Error('request_limit');
  if (value === null || typeof value !== 'object') return scalar(state, value);
  if (state.ancestors.has(value)) throw new Error('invalid_json');
  state.ancestors.add(value);
  if (Array.isArray(value)) array(state, value, depth);
  else object(state, value, depth);
  state.ancestors.delete(value);
}

/** Bounds bytes, depth, node count and each collection; rejects non-JSON values. */
export function encodeJson(input: unknown, maximumBytes: number): string {
  const state: EncoderState = { bytes: 0, nodes: 0, maximum: maximumBytes, parts: [], ancestors: new Set() };
  visit(state, input, 0);
  return state.parts.join('');
}

export async function readJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body) throw new Error('missing_body');
  const reader = response.body.getReader();
  const body = new Uint8Array(maximumBytes);
  let size = 0;
  let fragments = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (++fragments > 4096 || size + chunk.value.byteLength > maximumBytes) throw new Error('response_limit');
      body.set(chunk.value, size); size += chunk.value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size))) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
