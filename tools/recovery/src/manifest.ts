import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { decodeRecoveryLine, encodeRecoveryLine, recoveryCaps, RecoveryManifest } from '@beetle/contracts/recovery';
import type { RecoveryRecord } from '@beetle/contracts/recovery';
import type { RecoveryIO } from './io.js';
import { CHUNK, directory, regular, stable, syncDirectory, write } from './files.js';
import { RecoveryError } from './types.js';
/** Fixed read buffer and bounded partial line; parsing completes only at native EOF. */
export async function readManifest(io: RecoveryIO, path: string) {
  await directory(io, dirname(path));
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const parser = new RecoveryManifest(); const hash = createHash('sha256');
  try {
    const before = await io.issue(() => file.value.stat({bigint: true})); regular(before, recoveryCaps.manifestBytes);
    const buffer = new Uint8Array(CHUNK); let pending: Uint8Array = new Uint8Array(0); let offset = 0;
    while (true) {
      const part = await io.issue(() => file.value.read(buffer, 0, CHUNK, offset));
      if (part.bytesRead === 0) break;
      offset += part.bytesRead; if (offset > recoveryCaps.manifestBytes) throw new RecoveryError('limit');
      const bytes = buffer.subarray(0, part.bytesRead); hash.update(bytes);
      let start = 0;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) {
        const line = combine(pending, bytes.subarray(start, i)); parser.accept(decodeRecoveryLine(line)); pending = new Uint8Array(0); start = i + 1;
      }
      pending = combine(pending, bytes.subarray(start));
    }
    if (pending.length || offset !== Number(before.size) || stable(before) !== stable(await io.issue(() => file.value.stat({bigint: true})))) throw new RecoveryError('integrity');
    return Object.freeze({...parser.finish(), sha256: hash.digest('hex')});
  } finally {await io.close(file);}
}
function combine(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length + right.length >= recoveryCaps.lineBytes) throw new RecoveryError('limit');
  const bytes = new Uint8Array(left.length + right.length); bytes.set(left); bytes.set(right, left.length); return bytes;
}
export async function writeManifest(io: RecoveryIO, path: string, records: Iterable<RecoveryRecord>, maximum: number) {
  await directory(io, dirname(path));
  const file = await io.acquireFile(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
  const parser = new RecoveryManifest(); const hash = createHash('sha256'); let position = 0;
  try {
    for (const record of records) {
      parser.accept(record); const bytes = encodeRecoveryLine(record);
      if (position + bytes.length > maximum) throw new RecoveryError('limit');
      position = await write(io, file, bytes, position); hash.update(bytes);
    }
    const result = parser.finish(); await io.issue(() => file.value.sync());
    return Object.freeze({...result, sha256: hash.digest('hex')});
  } finally {await io.close(file); await syncDirectory(io, dirname(path));}
}
