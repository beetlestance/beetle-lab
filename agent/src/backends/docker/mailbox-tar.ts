import { MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';

export const MAILBOX_ARCHIVE_BYTES = 98304;
const name = 'live-metrics.mailbox';
export class MailboxArchiveError extends Error {
  constructor() {super('Live mailbox archive unavailable'); this.name = 'MailboxArchiveError';}
}
function requireValue(value: unknown): asserts value {if (!value) throw new MailboxArchiveError();}
function zero(bytes: Uint8Array): boolean {return bytes.every(byte => byte === 0);}
function text(bytes: Uint8Array): string {
  const end = bytes.indexOf(0); const value = end === -1 ? bytes : bytes.subarray(0, end);
  requireValue(value.every(byte => byte >= 32 && byte <= 126)); return new TextDecoder().decode(value);
}
function number(bytes: Uint8Array): number {
  const value = new TextDecoder().decode(bytes).replace(/[\0 ]+$/g, '').trim();
  requireValue(/^[0-7]+$/.test(value)); const parsed = Number.parseInt(value, 8);
  requireValue(Number.isSafeInteger(parsed) && parsed >= 0); return parsed;
}
function header(bytes: Uint8Array) {
  requireValue(bytes.length === 512);
  const checksum = bytes.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  requireValue(number(bytes.subarray(148, 156)) === checksum);
  requireValue(text(bytes.subarray(257, 263)).trim() === 'ustar' && text(bytes.subarray(345, 500)) === '');
  return {name: text(bytes.subarray(0, 100)), size: number(bytes.subarray(124, 136)), type: bytes[156]};
}
function pax(bytes: Uint8Array): void {
  requireValue(bytes.length <= 4096 && bytes.every(byte => byte === 10 || byte >= 32 && byte <= 126));
  const value = new TextDecoder().decode(bytes); let offset = 0; const keys = new Set<string>();
  for (let entries = 0; offset < value.length; entries++) {
    requireValue(entries < 8); const space = value.indexOf(' ', offset);
    requireValue(space > offset && space - offset <= 4 && /^[0-9]+$/.test(value.slice(offset, space)));
    const end = offset + Number(value.slice(offset, space));
    requireValue(end > space + 1 && end <= value.length && value[end - 1] === '\n');
    const row = value.slice(space + 1, end - 1); const equals = row.indexOf('='); requireValue(equals > 0);
    const key = row.slice(0, equals); const item = row.slice(equals + 1); requireValue(!keys.has(key)); keys.add(key);
    if (key === 'path') requireValue(item === name);
    else if (key === 'size') requireValue(item === String(MAILBOX_BYTES));
    else {requireValue(['mtime', 'atime', 'ctime', 'uid', 'gid'].includes(key)); requireValue(/^-?[0-9]{1,20}(?:\.[0-9]{1,20})?$/.test(item));}
    offset = end;
  }
}
/** Parse one fixed regular entry, never extract a path or allocate from archive sizes. */
export function captureMailboxArchive(input: Uint8Array): Uint8Array {
  try {
    requireValue(input instanceof Uint8Array && input.length <= MAILBOX_ARCHIVE_BYTES && input.length % 512 === 0);
    let offset = 0; let info = header(input.subarray(0, 512));
    if (info.type === 120) {
      requireValue(info.size >= 1 && info.size <= 4096);
      pax(input.subarray(512, 512 + info.size)); offset = 512 + Math.ceil(info.size / 512) * 512;
      requireValue(zero(input.subarray(512 + info.size, offset))); info = header(input.subarray(offset, offset + 512));
    }
    requireValue(info.name === name && (info.type === 0 || info.type === 48) && info.size === MAILBOX_BYTES);
    const start = offset + 512; const end = start + MAILBOX_BYTES; const padded = start + Math.ceil(MAILBOX_BYTES / 512) * 512;
    requireValue(input.length >= padded + 1024 && zero(input.subarray(end)));
    return Uint8Array.from(input.subarray(start, end));
  } catch {throw new MailboxArchiveError();}
}
