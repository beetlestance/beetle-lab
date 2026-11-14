import { constants } from 'node:fs';
import { join } from 'node:path';
import { openApplication } from '../../../../app/src/bootstrap/api.js';
import type { Application } from '../../../../app/src/bootstrap/api.js';
import { inspectHistoricalRecovery, openBackendHistorical } from '../../../../app/src/bootstrap/recovery-control/index.js';
import { attest } from '../attestation.js';
import { readClaim, checkClaimDirectories } from '../claim.js';
import { child, regular } from '../files.js';
import { RecoveryIO } from '../io.js';
import { knownTree } from '../known-tree.js';
import { readManifest } from '../manifest.js';
import { check, limits, RecoveryError } from '../types.js';
import type { RecoveryLimits, RecoveryOperation } from '../types.js';
import { verifyReferences } from '../references.js';
import { HistoryReader } from './reader.js';
import { historicalInputs } from './inputs.js';
const stranded = new Set<unknown>();
export async function openHistoryViewer(input: {root: string; externalOrigin: string; metadataWorkerUrl: URL; limits: RecoveryLimits; operation: RecoveryOperation}): Promise<Application> {
  const io = new RecoveryIO(input.operation); let gate: ReturnType<typeof openBackendHistorical> | undefined; let reader: HistoryReader | undefined; let applicationIssued = false;
  try {
    const claim = await readClaim(io, input.root); const manifest = await readManifest(io, join(input.root, 'manifest.ndjson'));
    if (manifest.sha256 !== claim.manifestDigest || manifest.header.backupId !== claim.backupId) throw new RecoveryError('integrity');
    bounds(manifest, input.limits);
    const path = join(input.root, 'history-control.sqlite'); const state = inspectHistoricalRecovery(path, claim.historyId);
    gate = openBackendHistorical({path, historyId: claim.historyId, operationId: claim.operationId,
      manifestDigest: claim.manifestDigest, attestationDigest: state.attestationDigest});
    await layout(io, input.root, manifest.entries);
    const proof = await attest(io, claim, manifest.entries);
    if (proof.digest !== state.attestationDigest) throw new RecoveryError('integrity');
    const installation = await readConfiguration(io, child(join(input.root, 'data'), manifest.header.roles.installationConfig));
    const historicalIdentity = proof.files.get(manifest.header.roles.metadata);
    if (!historicalIdentity) throw new RecoveryError('integrity');
    const metadata = {path: child(join(input.root, 'data'), manifest.header.roles.metadata), workerUrl: input.metadataWorkerUrl,
      installation, runtime: null, readOnly: true as const, historicalIdentity};
    await verifyReferences(io, join(input.root, 'data'), manifest.header, manifest.entries, {options: metadata, maximum: input.limits.maximumEntries});
    await io.closeAll(); check(input.operation); checkClaimDirectories(claim);
    reader = new HistoryReader(claim, manifest.header, manifest.entries, proof);
    const files = reader; const control = gate; let closing: Promise<void> | undefined;
    const close = () => {if (!closing) closing = files.close().then(() => {control.close();}); return closing;};
    applicationIssued = true;
    return await openApplication({externalOrigin: input.externalOrigin, localAccess: 'automatic', metadata,
      historical: {historyId: claim.historyId, sessions: gate.sessions, bytes: reader.outputs,
        openInputs: store => historicalInputs(store, files, manifest.header.roles.inputs), close}});
  } catch (error) {
    if (applicationIssued) {stranded.add({io, gate, reader}); throw error;}
    try {await io.closeAll(); await reader?.close(); gate?.close();} catch {stranded.add({io, gate, reader}); throw new RecoveryError('cleanup');}
    throw error;
  }
}
async function layout(io: RecoveryIO, root: string, entries: readonly {path: string; kind: 'file' | 'directory'}[]) {
  const expected = new Map<string, 'file' | 'directory'>([['history.json','file'], ['history-control.sqlite','file'], ['manifest.ndjson','file'], ['data','directory'], ['work','directory']]);
  for (const entry of entries) expected.set('data/' + entry.path, entry.kind);
  if (await knownTree(io, root, expected) !== expected.size) throw new RecoveryError('incomplete');
}
async function readConfiguration(io: RecoveryIO, path: string) {
  const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await io.issue(() => file.value.stat({bigint: true})); regular(info, 65536);
    const bytes = new Uint8Array(Number(info.size)); const result = await io.issue(() => file.value.read(bytes, 0, bytes.length, 0));
    if (result.bytesRead !== bytes.length) throw new RecoveryError('integrity');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as Parameters<typeof openApplication>[0]['metadata']['installation'];
  } finally {await io.close(file);}
}

function bounds(manifest: Awaited<ReturnType<typeof readManifest>>, input: RecoveryLimits): void {
  const bound = limits(input);
  if (manifest.entries.length > bound.maximumEntries || manifest.bytes + manifest.manifestBytes + 73728 > bound.maximumBytes) throw new RecoveryError('limit');
}
