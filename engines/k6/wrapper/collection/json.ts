import { SummaryError } from './types.js';

/** Scan bounded raw JSON before parsing; preserve duplicate-key detection. */
export function parseSummary(bytes: Uint8Array): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new SummaryError('invalid'); }
  const scanner = new Scanner(text);
  scanner.value(0); scanner.space();
  if (scanner.position !== text.length) throw new SummaryError('invalid');
  try { return JSON.parse(text) as unknown; }
  catch { throw new SummaryError('invalid'); }
}
class Scanner {
  position = 0;
  private nodes = 0;
  constructor(private readonly text: string) {}
  space(): void { while (/\s/.test(this.text[this.position] ?? '') && this.position < this.text.length) this.position++; }
  private token(): string {
    const start = this.position++;
    while (this.position < this.text.length) {
      const character = this.text[this.position++];
      if (character === '\\') this.position++;
      else if (character === '"') {
        try { return JSON.parse(this.text.slice(start, this.position)) as string; }
        catch { throw new SummaryError('invalid'); }
      }
    }
    throw new SummaryError('invalid');
  }
  value(depth: number): void {
    if (depth > 64 || ++this.nodes > 65_536) throw new SummaryError('limit');
    this.space();
    const character = this.text[this.position];
    if (character === '{' || character === '[') return this.collection(depth, character);
    if (character === '"') { this.token(); return; }
    const start = this.position;
    while (this.position < this.text.length && !/[\s,}\]]/.test(this.text[this.position]!)) this.position++;
    if (start === this.position) throw new SummaryError('invalid');
  }
  private collection(depth: number, opening: string): void {
    this.position++; this.space();
    const closing = opening === '{' ? '}' : ']';
    if (this.text[this.position] === closing) { this.position++; return; }
    const keys = new Set<string>();
    for (let count = 0; ; count++) {
      if (count >= 4096) throw new SummaryError('limit');
      this.space();
      if (opening === '{') {
        this.key(keys);
      }
      this.value(depth + 1); this.space();
      const next = this.text[this.position++];
      if (next === closing) return;
      if (next !== ',') throw new SummaryError('invalid');
    }
  }
  private key(keys: Set<string>): void {
    if (this.text[this.position] !== '"') throw new SummaryError('invalid');
    const key = this.token();
    if (keys.has(key)) throw new SummaryError('invalid');
    keys.add(key); this.space();
    if (this.text[this.position++] !== ':') throw new SummaryError('invalid');
  }
}
