import { chmod, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { initializeHistoricalRecovery, openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import { verifyArchive } from './archive.js';
import { attest } from './attestation.js';
import { checkClaimDirectories, createClaim, readClaim } from './claim.js';
import type { HistoryClaim } from './claim.js';
import { child, createDirectory, directory, syncDirectory } from './files.js';
import { RecoveryIO } from './io.js';
import { outside } from './layout.js';
import { readManifest } from './manifest.js';
import { knownTree } from './known-tree.js';
import { publishCopy } from './publication.js';
import type { RecoveryLimits, RecoveryOperation } from './types.js';
import { check, RecoveryError } from './types.js';
const stranded = new Set<unknown>();
type Archive = Awaited<ReturnType<typeof verifyArchive>>;
export interface RestoreRequest {
  readonly archive: string; readonly destination: string; readonly operationId: string; readonly resume?: true;
  readonly limits: RecoveryLimits; readonly operation: RecoveryOperation;
}
/** A history root is never a replacement serving installation. No source mutation. */
export async function restoreHistory(request: RestoreRequest) {
  validateRequest(request);
  const io = new RecoveryIO(request.operation); let lease: ReturnType<typeof openBackendRecovery> | undefined;
  try {
    const archive = await verifyArchive(io, request.archive, request.limits);
    if (archive.bytes + archive.manifestBytes + 65536 + 8192 > request.limits.maximumBytes) throw new RecoveryError('limit');
    const claim = request.resume ? await readClaim(io, request.destination) : await prepare(io, request, archive);
    matchClaim(claim, request, archive);
    lease = openBackendRecovery(join(request.destination, 'history-control.sqlite'), claim.historyId);
    const state = lease.snapshot();
    if (state.operationId !== claim.operationId || state.manifestDigest !== claim.manifestDigest || state.purpose !== 'history') throw new RecoveryError('conflict');
    if (state.phase === 'historical') {
      await completed(io, claim, archive, state.attestationDigest); await io.closeAll(); check(request.operation); checkClaimDirectories(claim); lease.close(); check(request.operation);
      return Object.freeze({historyId: claim.historyId, operationId: claim.operationId, phase: 'historical' as const});
    }
    await copy(io, claim, request.archive, archive);
    const proof = await attest(io, claim, archive.entries); await io.closeAll(); check(request.operation); checkClaimDirectories(claim);
    lease.completeHistorical(claim.operationId, claim.manifestDigest, proof.digest); lease.close(); check(request.operation);
    return Object.freeze({historyId: claim.historyId, operationId: claim.operationId, phase: 'historical' as const});
  } catch (error) {
    try {await io.closeAll(); lease?.close();} catch {stranded.add({io, lease}); throw new RecoveryError('cleanup');}
    throw error;
  }
}
async function prepare(io: RecoveryIO, request: RestoreRequest, archive: Archive) {
  await directory(io, dirname(request.destination)); await createDirectory(io, request.destination);
  await createDirectory(io, join(request.destination, 'work')); await createDirectory(io, join(request.destination, 'data'));
  const claim = await createClaim(io, request.destination, request.operationId, archive);
  initializeHistoricalRecovery({path: join(request.destination, 'history-control.sqlite'), historyId: claim.historyId,
    operationId: claim.operationId, manifestDigest: claim.manifestDigest}); return claim;
}
function matchClaim(claim: HistoryClaim, request: RestoreRequest, archive: Archive): void {
  if (claim.operationId !== request.operationId || claim.backupId !== archive.header.backupId || claim.manifestDigest !== archive.sha256) throw new RecoveryError('conflict');
}
function expected(archive: Archive, partial: boolean) {
  const entries = new Map<string, 'file' | 'directory'>([['history.json','file'], ['history-control.sqlite','file'], ['manifest.ndjson','file'], ['data','directory'], ['work','directory']]);
  archive.entries.forEach((entry, index) => {
    entries.set('data/' + entry.path, entry.kind);
    if (partial && entry.kind === 'file') entries.set('work/' + index + '.part', 'file');
  });
  if (partial) entries.set('work/' + archive.entries.length + '.part', 'file'); return entries;
}
async function copy(io: RecoveryIO, claim: HistoryClaim, source: string, archive: Archive): Promise<void> {
  await knownTree(io, claim.destination, expected(archive, true));
  for (const [index, entry] of archive.entries.entries()) {
    const target = child(join(claim.destination, 'data'), entry.path);
    if (entry.kind === 'directory') await ensure(io, target);
    else await publishCopy(io, child(source, entry.path), target, join(claim.destination, 'work', index + '.part'), entry);
  }
  await publishCopy(io, join(source, 'manifest.ndjson'), join(claim.destination, 'manifest.ndjson'),
    join(claim.destination, 'work', archive.entries.length + '.part'), {bytes: archive.manifestBytes, sha256: archive.sha256});
  for (const entry of [...archive.entries].reverse()) if (entry.kind === 'directory') {
    const path = child(join(claim.destination, 'data'), entry.path); await io.issue(() => chmod(path, 0o500)); await syncDirectory(io, path);
  }
  await io.issue(() => chmod(join(claim.destination, 'data'), 0o500)); await syncDirectory(io, claim.destination);
  await completeLayout(io, claim, archive);
}
async function ensure(io: RecoveryIO, path: string): Promise<void> {
  try {await io.issue(() => lstat(path));} catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    await createDirectory(io, path);
  }
  await directory(io, path);
}
async function completeLayout(io: RecoveryIO, claim: HistoryClaim, archive: Archive): Promise<void> {
  const entries = expected(archive, false);
  if ((await readManifest(io, join(claim.destination, 'manifest.ndjson'))).sha256 !== archive.sha256) throw new RecoveryError('integrity');
  if (await knownTree(io, claim.destination, entries) !== entries.size) throw new RecoveryError('incomplete');
}
async function completed(io: RecoveryIO, claim: HistoryClaim, archive: Archive, digest: string): Promise<void> {
  await completeLayout(io, claim, archive);
  const result = await attest(io, claim, archive.entries); if (result.digest !== digest) throw new RecoveryError('integrity');
}

function validateRequest(request: RestoreRequest): void {
  if (!validatePrimitive('uuid', request.operationId).ok || request.operationId !== request.operationId.toLowerCase()) throw new RecoveryError('invalid_input');
  if (request.resume !== undefined && request.resume !== true) throw new RecoveryError('invalid_input');
  outside(request.archive, request.destination); outside(request.destination, request.archive);
}
