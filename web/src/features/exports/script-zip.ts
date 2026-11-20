import { maximumExportScriptBytes } from './script-bytes.js';

const name = new TextEncoder().encode('script.js');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]!) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function writeEntry(header: DataView, versionOffset: number, crc: number, length: number) {
  header.setUint16(versionOffset, 10, true); // ZIP 1.0, stored without compression
  header.setUint16(versionOffset + 8, 0x0021, true); // first valid DOS date
  header.setUint32(versionOffset + 10, crc, true);
  header.setUint32(versionOffset + 14, length, true);
  header.setUint32(versionOffset + 18, length, true);
  header.setUint16(versionOffset + 22, name.length, true);
}

/** Wrap already verified bytes in one stored entry. PKWARE APPNOTE sections 4.3.7, 4.3.12 and 4.3.16. */
export function scriptZip(bytes: Uint8Array<ArrayBuffer>): Blob {
  if (bytes.length < 1 || bytes.length > maximumExportScriptBytes) throw new Error('Invalid script size for ZIP.');

  const crc = crc32(bytes);
  const local = new Uint8Array(30 + name.length);
  const localHeader = new DataView(local.buffer);
  localHeader.setUint32(0, 0x04034b50, true);
  writeEntry(localHeader, 4, crc, bytes.length);
  local.set(name, 30);

  const directory = new Uint8Array(46 + name.length);
  const directoryHeader = new DataView(directory.buffer);
  directoryHeader.setUint32(0, 0x02014b50, true);
  directoryHeader.setUint16(4, 10, true);
  writeEntry(directoryHeader, 6, crc, bytes.length);
  directory.set(name, 46);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, local.length + bytes.length, true);

  return new Blob([local, bytes, directory, end.buffer], { type: 'application/zip' });
}
