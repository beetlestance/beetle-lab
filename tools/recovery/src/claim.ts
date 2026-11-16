import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodeCanonicalJson, validatePrimitive } from '@beetle/contracts';
import type { RecoveryIO } from './io.js';
import { directory, hashFile, syncDirectory, write } from './files.js';
import { RecoveryError } from './types.js';
export interface HistoryClaim {
  readonly version: 1; readonly destination: string; readonly rootIdentity: string; readonly workIdentity: string;
  readonly historyId: string; readonly operationId: string; readonly backupId: string; readonly manifestDigest: string;
}
export function rootIdentity(info: BigIntStats): string {
  return createHash('sha256').update('beetle-history-root/v1\n').update([info.dev, info.ino, info.uid, info.gid, info.mode].join(':')).digest('hex');
}
export function claim(input: unknown): HistoryClaim {
  const text = encodeCanonicalJson(input, 8191); const value = JSON.parse(text) as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'backupId,destination,historyId,manifestDigest,operationId,rootIdentity,version,workIdentity') throw new RecoveryError('integrity');
  if (value.version !== 1 || typeof value.destination !== 'string' || value.destination.length > 4096) throw new RecoveryError('integrity');
  identifiers(value);
  return Object.freeze(value) as unknown as HistoryClaim;
}
export async function createClaim(io: RecoveryIO, destination: string, operationId: string, archive: {sha256: string; header: {backupId: string}}) {
  const captured = claim({version: 1, destination, operationId, historyId: randomUUID(), backupId: archive.header.backupId,
    manifestDigest: archive.sha256, rootIdentity: rootIdentity(await directory(io, destination)), workIdentity: rootIdentity(await directory(io, join(destination, 'work')))});
  const path = join(destination, 'history.json'); const file = await io.acquireFile(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
  try {await write(io, file, new TextEncoder().encode(encodeCanonicalJson(captured, 8191)), 0); await io.issue(() => file.value.sync());}
  finally {await io.close(file);}
  await syncDirectory(io, dirname(path)); return captured;
}
export async function readClaim(io: RecoveryIO, destination: string): Promise<HistoryClaim> {
  const path = join(destination, 'history.json'); const observed = await hashFile(io, path, 8191);
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = new Uint8Array(observed.bytes); const result = await io.issue(() => file.value.read(bytes, 0, bytes.length, 0));
    if (result.bytesRead !== bytes.length) throw new RecoveryError('integrity');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); const captured = claim(JSON.parse(text));
    if (createHash('sha256').update(bytes).digest('hex') !== observed.sha256 || encodeCanonicalJson(captured, 8191) !== text || captured.destination !== destination || captured.rootIdentity !== rootIdentity(await directory(io, destination)) || captured.workIdentity !== rootIdentity(await directory(io, join(destination, 'work')))) throw new RecoveryError('integrity');
    return captured;
  } finally {await io.close(file);}
}

function identifiers(value: Record<string, unknown>): void {
  for (const key of ['historyId','operationId','backupId']) if (typeof value[key] !== 'string' || !validatePrimitive('uuid', value[key]).ok || value[key] !== value[key].toLowerCase()) throw new RecoveryError('integrity');
  for (const key of ['rootIdentity','workIdentity','manifestDigest']) if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key])) throw new RecoveryError('integrity');
}

/** Last synchronous fence after every issued asynchronous owner has drained. */
export function checkClaimDirectories(value: HistoryClaim): void {
  for (const [path, expected] of [[value.destination, value.rootIdentity], [join(value.destination, 'work'), value.workIdentity]] as const) {
    const info = lstatSync(path, {bigint: true});
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid!()) || (info.mode & 0o077n) || realpathSync(path) !== path || rootIdentity(info) !== expected) throw new RecoveryError('integrity');
  }
}
