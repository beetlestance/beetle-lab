import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/** Fixed metadata leaf; no symlinks, unbounded readFile or mutable parsing hooks. */
export async function readDeliveryBytes(path: string): Promise<Buffer> {
  const maximum = 262144; const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw new Error('Delivery metadata bound');
    const buffer = Buffer.alloc(maximum + 1); let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await file.read(buffer, offset, buffer.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maximum) throw new Error('Delivery metadata bound');
    return buffer.subarray(0, offset);
  } finally {await file.close();}
}
export async function readDeliveryJson(path: string): Promise<unknown> {
  return JSON.parse((await readDeliveryBytes(path)).toString('utf8')) as unknown;
}
export async function deliveryDigest(path: string, maximum: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > maximum) throw new Error('Delivery archive size bound');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of file.createReadStream({autoClose: false, highWaterMark: 65536})) {
      bytes += chunk.length;
      if (bytes > maximum) throw new Error('Delivery archive size bound');
      hash.update(chunk);
    }
    if (bytes !== info.size) throw new Error('Delivery archive changed');
    return {bytes, sha256: hash.digest('hex')};
  } finally {await file.close();}
}
