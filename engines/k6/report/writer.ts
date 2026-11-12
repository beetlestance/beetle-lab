export class ReportError extends Error {
  constructor(readonly code: 'invalid_input' | 'output_limit') {super('Performance report rejected'); this.name = 'ReportError';}
}
/** Independent byte cap per output, including separators and final newline. */
export class ReportWriter {
  private readonly parts: string[] = [];
  private bytes = 0;
  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 262144) throw new ReportError('invalid_input');
  }
  line(value: string): void {
    const part = value + '\n'; const next = this.bytes + Buffer.byteLength(part);
    if (next > this.maximum) throw new ReportError('output_limit');
    this.parts.push(part); this.bytes = next;
  }
  finish(): Uint8Array {return Buffer.from(this.parts.join(''));}
}
/** Quote CSV text and neutralize spreadsheet formulas without changing numeric cells. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
