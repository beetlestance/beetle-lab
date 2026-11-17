import type { InputShape } from '../../ports/inputs.js';

/** Parse budget for publication-time counts. Over budget means null, never an estimate. */
export const INPUT_SHAPE_LIMITS = Object.freeze({ rows: 1_048_576, columns: 1024, jsonBytes: 2_097_152 });
export type ShapeKind = 'csv' | 'json';
export function shapeKind(name: string, bytes: number): ShapeKind | null {
  const lowered = name.toLowerCase();
  const kind = lowered.endsWith('.csv') ? 'csv' : lowered.endsWith('.json') ? 'json' : null;
  if (kind === null || bytes < 1) return null;
  return kind === 'json' && bytes > INPUT_SHAPE_LIMITS.jsonBytes ? null : kind;
}
export interface ShapeCounter {
  write(chunk: Uint8Array): void;
  finish(): InputShape | null;
}
export function shapeCounter(kind: ShapeKind): ShapeCounter {
  return kind === 'csv' ? new CsvCounter() : new JsonCounter();
}

/** Strict RFC 4180 records: the first record is the header and every record must match it. */
class CsvCounter implements ShapeCounter {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private invalid = false;
  private quoted = false;
  private quotePending = false;
  private closed = false;
  private afterCr = false;
  private cellChars = 0;
  private fields = 0;
  private columns = 0;
  private records = 0;
  write(chunk: Uint8Array): void {
    if (this.invalid) return;
    try {
      this.text(this.decoder.decode(chunk, { stream: true }));
    } catch {
      this.invalid = true;
    }
  }
  finish(): InputShape | null {
    if (this.invalid) return null;
    try {
      this.text(this.decoder.decode());
      if (this.quotePending) this.endQuote();
      if (this.quoted) return null;
      if (this.fields || this.cellChars || this.closed) this.endRecord();
    } catch {
      return null;
    }
    return this.records === 0 ? null : { rowCount: this.records - 1, columnCount: this.columns };
  }
  private text(value: string): void {
    for (const char of value) {
      if (this.invalid) return;
      this.char(char);
    }
  }
  private char(char: string): void {
    const crlf = this.afterCr && char === '\n';
    this.afterCr = false;
    if (crlf) return;
    if (this.quotePending) {
      this.quotePending = false;
      if (char === '"') {
        this.cellChars++;
        return;
      }
      this.endQuote();
    }
    if (this.quoted) {
      if (char === '"') this.quotePending = true;
      else this.cellChars++;
      return;
    }
    this.unquoted(char);
  }
  private endQuote(): void {
    this.quoted = false;
    this.closed = true;
  }
  private unquoted(char: string): void {
    if (char === ',') this.endField();
    else if (char === '\n' || char === '\r') {
      this.endRecord();
      this.afterCr = char === '\r';
    } else if (char === '"' && !this.cellChars && !this.closed) this.quoted = true;
    else if (this.closed || char === '"') this.invalid = true;
    else this.cellChars++;
  }
  private endField(): void {
    if (++this.fields > INPUT_SHAPE_LIMITS.columns) this.invalid = true;
    this.cellChars = 0;
    this.closed = false;
  }
  private endRecord(): void {
    this.endField();
    if (this.records === 0) this.columns = this.fields;
    else if (this.fields !== this.columns) this.invalid = true;
    if (++this.records > INPUT_SHAPE_LIMITS.rows + 1) this.invalid = true;
    this.fields = 0;
  }
}

/** One top-level array; columns only when every element is an object with the first element's keys. */
class JsonCounter implements ShapeCounter {
  private readonly buffer = new Uint8Array(INPUT_SHAPE_LIMITS.jsonBytes);
  private size = 0;
  private invalid = false;
  write(chunk: Uint8Array): void {
    if (this.invalid) return;
    if (this.size + chunk.byteLength > this.buffer.byteLength) {
      this.invalid = true;
      return;
    }
    this.buffer.set(chunk, this.size);
    this.size += chunk.byteLength;
  }
  finish(): InputShape | null {
    if (this.invalid) return null;
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, this.size)));
    } catch {
      return null;
    }
    if (!Array.isArray(value) || value.length > INPUT_SHAPE_LIMITS.rows) return null;
    return { rowCount: value.length, columnCount: uniformColumns(value) };
  }
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function uniformColumns(rows: readonly unknown[]): number | null {
  const first = rows[0];
  if (!plainObject(first)) return null;
  const keys = Object.keys(first);
  if (keys.length < 1 || keys.length > INPUT_SHAPE_LIMITS.columns) return null;
  const uniform = rows.every(
    (row) =>
      plainObject(row) && Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)),
  );
  return uniform ? keys.length : null;
}
