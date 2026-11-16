import { utf8Bytes } from './bounds.js';
import type { RuntimeLimits } from './types.js';

interface Scanner { quoted: boolean; escaped: boolean; expectValue: boolean; nodes: number; stack: string[] }
function quotedCharacter(state: Scanner, character: string): void {
  if (state.escaped) state.escaped = false;
  else if (character === '\\') state.escaped = true;
  else if (character === '"') state.quoted = false;
}
function structural(state: Scanner, character: string): void {
  if (character === '"') state.quoted = true;
  else if (character === '[' || character === '{') { state.stack.push(character); state.expectValue = character === '['; }
  else if (character === ']' || character === '}') { state.stack.pop(); state.expectValue = false; }
  else if (character === ':' || character === ',') state.expectValue = character === ':' || state.stack.at(-1) === '[';
}
function scan(state: Scanner, character: string): void {
  if (state.quoted) { quotedCharacter(state, character); return; }
  if (state.expectValue && !/[\s,\]}:]/.test(character)) { state.nodes++; state.expectValue = false; }
  structural(state, character);
}
export function processableBody(body: string | null, limits: RuntimeLimits): body is string {
  if (body === null || body.length > limits.responseProcessingBytes) return false;
  try { utf8Bytes(body, limits.responseProcessingBytes); return true; } catch { return false; }
}
/** Native k6 has already buffered retained bodies. These are JS processing limits. */
export function responseJson(body: string | null, limits: RuntimeLimits): { ok: true; value: unknown } | { ok: false } {
  if (!processableBody(body, limits)) return { ok: false };
  const state: Scanner = { quoted: false, escaped: false, expectValue: true, nodes: 0, stack: [] };
  for (const character of body) {
    scan(state, character);
    if (state.nodes > limits.responseJsonNodes || state.stack.length > limits.responseJsonDepth) return { ok: false };
  }
  try { return { ok: true, value: JSON.parse(body) as unknown }; } catch { return { ok: false }; }
}
