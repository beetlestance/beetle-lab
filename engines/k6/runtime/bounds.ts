import { stop } from './failure.js';
import type { RuntimeLimits } from './types.js';

export const defaultLimits: Readonly<RuntimeLimits> = Object.freeze({ responseProcessingBytes: 1_048_576,
  responseJsonNodes: 65_536, responseJsonDepth: 32, secretBytes: 65_536,
  aggregateSecretBytes: 1_048_576, requestTimeoutMs: 30_000 });
export function runtimeLimits(input: Partial<RuntimeLimits> = {}): RuntimeLimits {
  const result = { ...defaultLimits, ...input };
  for (const [key, value] of Object.entries(result)) {
    const maximum = key === 'responseProcessingBytes' ? 8_388_608 : defaultLimits[key as keyof RuntimeLimits];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) stop('invalid_limits');
  }
  return Object.freeze(result);
}
/** Counts UTF-8 without allocating an encoded copy, including lone surrogate replacement. */
export function utf8Bytes(value: string, maximum = Infinity): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > maximum) stop('request_limit');
  }
  return bytes;
}
/** Every append is admitted before joining; chunks keep allocation overhead bounded. */
export class BoundedText {
  private readonly parts: string[] = [];
  private pending = '';
  private bytes = 0;
  private chars = 0;
  constructor(private readonly maxBytes: number, private readonly maxChars = Infinity) {}
  append(value: string): void {
    if (value.length > this.maxChars - this.chars) stop('request_limit');
    const bytes = utf8Bytes(value, this.maxBytes - this.bytes);
    this.bytes += bytes; this.chars += value.length;
    for (let offset = 0; offset < value.length; offset += 1024) {
      this.pending += value.slice(offset, offset + 1024);
      if (this.pending.length >= 1024) { this.parts.push(this.pending); this.pending = ''; }
    }
  }
  finish(): string { return this.parts.join('') + this.pending; }
}
export function quoted(writer: BoundedText, value: string): void {
  writer.append('"');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const character = value[index]!;
    if (character === '"' || character === '\\') writer.append('\\' + character);
    else if (code < 32 || (code >= 0xd800 && code <= 0xdfff)) {
      writer.append('\\u' + code.toString(16).padStart(4, '0'));
    } else writer.append(character);
  }
  writer.append('"');
}
