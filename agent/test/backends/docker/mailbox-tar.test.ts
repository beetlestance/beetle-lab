import { expect, it } from 'vitest';
import { MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { captureMailboxArchive } from '../../../src/backends/docker/mailbox-tar.js';
import { archive, paxArchive, tarHeader } from './mailbox-fixtures.js';
it('reads one expected regular USTAR file and detaches its exact fixed extent', () => {
  const image = new Uint8Array(MAILBOX_BYTES); image[123] = 17; const bytes = archive(image);
  const result = captureMailboxArchive(bytes); expect(result).toEqual(image); expect(result.buffer).not.toBe(bytes.buffer);
});
it.each(['path=live-metrics.mailbox', 'mtime=12345.123', `size=${MAILBOX_BYTES}`])('accepts one bounded compatible PAX header: %s', row => {
  expect(captureMailboxArchive(paxArchive(row))).toHaveLength(MAILBOX_BYTES);
});
it.each(['../secret', '/absolute', './other'])('rejects unexpected paths without extraction: %s', path => {
  expect(() => captureMailboxArchive(archive(undefined, path))).toThrow('Live mailbox archive unavailable');
});
it.each([49, 50, 53, 103])('rejects links, directories and global metadata: %s', type => {
  expect(() => captureMailboxArchive(archive(undefined, 'live-metrics.mailbox', type))).toThrow();
});
it('rejects corrupt checksum, false size, missing EOF, extra entries and nonzero padding', () => {
  const corrupt = archive(); corrupt[100] = 0; expect(() => captureMailboxArchive(corrupt)).toThrow();
  const size = archive(); size.set(tarHeader('live-metrics.mailbox', 1)); expect(() => captureMailboxArchive(size)).toThrow();
  expect(() => captureMailboxArchive(archive().subarray(0, -512))).toThrow();
  const extra = archive(); extra.set(tarHeader('extra', 0), extra.length - 1024); expect(() => captureMailboxArchive(extra)).toThrow();
  const padding = archive(); padding[512 + MAILBOX_BYTES] = 1; expect(() => captureMailboxArchive(padding)).toThrow();
});
it.each(['path=../secret', 'size=1000000000', 'linkpath=secret', 'mtime=nan'])('rejects unsupported PAX overrides: %s', row => {
  expect(() => captureMailboxArchive(paxArchive(row))).toThrow();
});
