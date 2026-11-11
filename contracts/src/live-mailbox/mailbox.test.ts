import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { captureMailboxImage, encodeMailboxHeader, MAILBOX_BYTES, MAILBOX_FOOTER_OFFSET, MAILBOX_HEADER_BYTES } from './index.js';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const frame = new TextEncoder().encode('{"example":1}'); const image = new Uint8Array(MAILBOX_BYTES);
  const header = encodeMailboxHeader({revision: 7, length: frame.length, digest: hash(frame), committed: true});
  image.set(header); image.set(frame, MAILBOX_HEADER_BYTES); image.set(header, MAILBOX_FOOTER_OFFSET); return {image, frame};
}
it('captures a fixed image with exact body digest and preserves the publication revision', () => {
  const f = fixture(); const value = captureMailboxImage(f.image, hash); expect(value.revision).toBe(7); expect(value.frame).toEqual(f.frame);
  expect(value.frame.buffer).toBe(f.image.buffer);
});
it.each(['busy', 'magic', 'reserved', 'revision', 'length', 'footer', 'body', 'size'] as const)('rejects unavailable or torn data: %s', change => {
  const f = fixture();
  if (change === 'busy') f.image[8] = 0;
  if (change === 'magic') f.image[0] = 0;
  if (change === 'reserved') f.image[9] = 1;
  if (change === 'revision') new DataView(f.image.buffer).setUint32(16, 0);
  if (change === 'length') new DataView(f.image.buffer).setUint32(20, 65537);
  if (change === 'footer') f.image[MAILBOX_FOOTER_OFFSET + 16] = 1;
  if (change === 'body') f.image[MAILBOX_HEADER_BYTES] = 0;
  const image = change === 'size' ? f.image.subarray(1) : f.image;
  expect(() => captureMailboxImage(image, hash)).toThrow('Live metric mailbox unavailable');
});
it('rejects matching malformed headers, bad options and digest capability failure', () => {
  const f = fixture(); f.image[9] = 1; f.image.set(f.image.subarray(0, 128), MAILBOX_FOOTER_OFFSET);
  expect(() => captureMailboxImage(f.image, hash)).toThrow();
  expect(() => encodeMailboxHeader({revision: 65537, length: 1, digest: '0'.repeat(64), committed: true})).toThrow();
  expect(() => encodeMailboxHeader({revision: 1, length: 0, digest: '0'.repeat(64), committed: true})).toThrow();
  expect(() => captureMailboxImage(fixture().image, () => {throw new Error('PRIVATE');})).toThrow('Live metric mailbox unavailable');
});
