import { expect, it } from 'vitest';
import { scriptZip } from './script-zip.js';

it('puts the original bytes in the sole stored script.js entry with a matching CRC', async () => {
  const source = Uint8Array.of(0xef, 0xbb, 0xbf, 0xc3, 0xa9, 0x0d, 0x0a);
  const zip = scriptZip(source);
  const archive = new Uint8Array(await zip.arrayBuffer());
  const header = new DataView(archive.buffer);
  const name = new TextDecoder();
  const end = archive.length - 22;
  const directory = header.getUint32(end + 16, true);
  const local = header.getUint32(directory + 42, true);
  const start = local + 30 + header.getUint16(local + 26, true);

  expect(zip.type).toBe('application/zip');
  expect(header.getUint32(end, true)).toBe(0x06054b50);
  expect(header.getUint16(end + 10, true)).toBe(1);
  expect(header.getUint32(directory, true)).toBe(0x02014b50);
  expect(header.getUint32(local, true)).toBe(0x04034b50);
  expect(name.decode(archive.subarray(directory + 46, end))).toBe('script.js');
  expect(name.decode(archive.subarray(local + 30, start))).toBe('script.js');
  expect(header.getUint16(local + 8, true)).toBe(0);
  expect(header.getUint32(local + 14, true)).toBe(0x6d34c5a7);
  expect(header.getUint32(directory + 16, true)).toBe(0x6d34c5a7);
  expect(header.getUint32(directory + 24, true)).toBe(source.length);
  expect(archive.subarray(start, directory)).toEqual(source);
});
