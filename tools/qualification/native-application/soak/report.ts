import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
export const maximumLongReportBytes = 4 * 1024 * 1024;
/** Private finite timing/sample report, separate from the stricter delivery metadata owner. */
export async function readLongReport(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat({ bigint: true });
    assert(info.isFile() && info.nlink === 1n && info.uid === BigInt(process.getuid!()) && (info.mode & 0o077n) === 0n);
    assert(info.size > 0n && info.size <= BigInt(maximumLongReportBytes));
    const bytes = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    for (let calls = 0; calls < 64; calls++) {
      const part = await file.read(bytes, offset, bytes.length - offset, offset);
      offset += part.bytesRead;
      assert(offset <= Number(info.size));
      if (part.bytesRead === 0) break;
    }
    assert.equal(offset, Number(info.size));
    const after = await file.stat({ bigint: true });
    for (const name of ['dev', 'ino', 'size', 'uid', 'gid', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'] as const)
      assert.equal(after[name], info[name]);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))) as unknown;
  } finally {
    await file.close();
  }
}
