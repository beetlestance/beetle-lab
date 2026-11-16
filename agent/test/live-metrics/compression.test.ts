import {expect, it} from 'vitest';
import {gzipSync} from 'node:zlib';
import {encodeLiveMetricSnapshot} from '@beetle/contracts/api';
import {encodeMailboxHeader, MAILBOX_BYTES, MAILBOX_HEADER_BYTES, MAILBOX_FOOTER_OFFSET, MAILBOX_PAYLOAD_BYTES} from '@beetle/contracts/live-mailbox';
import {fixture, hash} from './fixtures.js';
function wire(body: Uint8Array) {
 const image = new Uint8Array(MAILBOX_BYTES); const header = encodeMailboxHeader({revision: 1, length: body.length, digest: hash(body), committed: true});
 image.set(header); image.set(body, MAILBOX_HEADER_BYTES); image.set(header, MAILBOX_FOOTER_OFFSET); return image;
}
it('refuses malformed gzip, legacy plaintext and a small compressed expansion beyond the independent decoded bound', async () => {
 for (const payload of [new Uint8Array([1, 2, 3]), new TextEncoder().encode('{}'), gzipSync(Buffer.alloc(MAILBOX_PAYLOAD_BYTES + 1, 0x20))]) {
  expect(payload.length).toBeLessThan(MAILBOX_PAYLOAD_BYTES);
  const f = fixture(); f.set({ok: true, status: 200, image: wire(payload)});
  expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'unavailable'});
  f.set({ok: true, status: 200, image: wire(gzipSync(encodeLiveMetricSnapshot(f.initial, hash)))});
  expect((await f.reader.read(f.operation())).ok).toBe(true); await f.reader.close();
 }
});
it('accepts a valid snapshot at exactly the decoded64KiB limit with scope and sequence intact', async () => {
 const f = fixture(); const frame = encodeLiveMetricSnapshot(f.initial, hash);
 const decoded = Buffer.concat([frame, Buffer.alloc(MAILBOX_PAYLOAD_BYTES - frame.length, 0x20)]);
 expect(decoded.length).toBe(MAILBOX_PAYLOAD_BYTES);
 f.set({ok: true, status: 200, image: wire(gzipSync(decoded))});
 expect(await f.reader.read(f.operation())).toEqual({ok: true, frame: f.initial}); await f.reader.close();
});
it('retains the compressed-envelope hash fence even for an otherwise valid frame', async () => {
 const f = fixture(); const bytes = wire(gzipSync(encodeLiveMetricSnapshot(f.initial, hash))); bytes[MAILBOX_HEADER_BYTES + 12] = bytes[MAILBOX_HEADER_BYTES + 12]! ^ 1;
 f.set({ok: true, status: 200, image: bytes}); expect(await f.reader.read(f.operation())).toEqual({ok: false, reason: 'unavailable'}); await f.reader.close();
});
