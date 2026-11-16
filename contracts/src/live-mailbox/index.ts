export const MAILBOX_HEADER_BYTES = 128;
export const MAILBOX_PAYLOAD_BYTES = 65536;
export const MAILBOX_FOOTER_OFFSET = MAILBOX_HEADER_BYTES + MAILBOX_PAYLOAD_BYTES;
export const MAILBOX_BYTES = MAILBOX_FOOTER_OFFSET + MAILBOX_HEADER_BYTES;
export const LIVE_MAILBOX_PATH = '/beetle/live/live-metrics.mailbox';
export type MailboxHash = (bytes: Uint8Array) => string;
const magic = new TextEncoder().encode('BLIVE001');
export class LiveMailboxError extends Error {
  constructor() {super('Live metric mailbox unavailable'); this.name = 'LiveMailboxError';}
}
function requireValue(value: unknown): asserts value {if (!value) throw new LiveMailboxError();}
function integer(value: number, maximum: number): boolean {return Number.isInteger(value) && value >= 1 && value <= maximum;}
function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
/** Fixed binary envelope; body and reserved bytes never contain caller-selected paths. */
export function encodeMailboxHeader(input: {revision: number; length: number; digest: string; committed: boolean}): Uint8Array {
  requireValue(integer(input.revision, 65536) && integer(input.length, MAILBOX_PAYLOAD_BYTES));
  requireValue(typeof input.digest === 'string' && /^[0-9a-f]{64}$/.test(input.digest) && typeof input.committed === 'boolean');
  const bytes = new Uint8Array(MAILBOX_HEADER_BYTES); bytes.set(magic); bytes[8] = input.committed ? 1 : 0;
  const view = new DataView(bytes.buffer); view.setUint32(16, input.revision); view.setUint32(20, input.length);
  for (let index = 0; index < 32; index++) bytes[index + 24] = Number.parseInt(input.digest.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
function captureHeader(bytes: Uint8Array) {
  requireValue(bytes.length === MAILBOX_HEADER_BYTES && equal(bytes.subarray(0, 8), magic) && bytes[8] === 1);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const revision = view.getUint32(16); const length = view.getUint32(20);
  const digest = Array.from(bytes.subarray(24, 56), byte => byte.toString(16).padStart(2, '0')).join('');
  requireValue(equal(bytes, encodeMailboxHeader({revision, length, digest, committed: true})));
  return {revision, length, digest};
}
/** A finite image from one transport original; races fail rather than retry. */
export function captureMailboxImage(bytes: Uint8Array, hash: MailboxHash): {revision: number; frame: Uint8Array} {
  try {
    requireValue(bytes instanceof Uint8Array && bytes.length === MAILBOX_BYTES);
    const head = bytes.subarray(0, MAILBOX_HEADER_BYTES); const footer = bytes.subarray(MAILBOX_FOOTER_OFFSET);
    requireValue(equal(head, footer)); const header = captureHeader(head);
    const frame = bytes.subarray(MAILBOX_HEADER_BYTES, MAILBOX_HEADER_BYTES + header.length);
    requireValue(hash(frame) === header.digest);
    return {revision: header.revision, frame};
  } catch {throw new LiveMailboxError();}
}
