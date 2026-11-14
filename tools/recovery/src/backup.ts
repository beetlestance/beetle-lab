import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { RecoveryHeader } from '@beetle/contracts/recovery';
import { captureRecoveryRecord } from '@beetle/contracts/recovery';
import { initializeHistoricalRecovery, openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import { openColdSource } from './source.js';
import type { SourceContext } from './source.js';
import { outside, sourcePaths } from './layout.js';
import type { SourceLayout } from './layout.js';
import { SnapshotTree } from './tree.js';
import { RecoveryIO } from './io.js';
import { createDirectory, directory } from './files.js';
import { writeManifest } from './manifest.js';
import { verifyReferences } from './references.js';
import type { RecoveryLimits, RecoveryOperation } from './types.js';
import { check, limits, RecoveryError } from './types.js';
const stranded = new Set<unknown>();
const CONTROL_ALLOWANCE = 65536;
/** Explicit cold operation: never stops services or adopts an existing destination. */
export async function coldBackup(request: {layout: SourceLayout; destination: string; limits: RecoveryLimits; operation: RecoveryOperation}, context: SourceContext) {
  const bounds = limits(request.limits); outside(request.layout.root, request.destination); outside(request.destination, request.layout.root);
  const io = new RecoveryIO(request.operation); let source: Awaited<ReturnType<typeof openColdSource>> | undefined;
  try {
    if (bounds.maximumBytes <= CONTROL_ALLOWANCE) throw new RecoveryError('limit');
    await directory(io, dirname(request.destination)); source = await openColdSource(io, request.layout, context);
    await createDirectory(io, request.destination);
    const result = await snapshot(io, request, bounds, source.captured);
    // Every acquired metadata/config/file owner drains before releasing real startup exclusion.
    await io.closeAll(); check(request.operation); source.agentLease.close(); source.backendLease.close(); source = undefined;
    check(request.operation); seal(request.destination, result.header.backupId, result.sha256); check(request.operation);
    return Object.freeze({backupId: result.header.backupId, manifestDigest: result.sha256,
      files: result.files, directories: result.directories, payloadBytes: result.bytes, manifestBytes: result.manifestBytes, controlAllowanceBytes: CONTROL_ALLOWANCE});
  } catch (error) {
    try {await io.closeAll(); source?.agentLease.close(); source?.backendLease.close();}
    catch {stranded.add({io, source}); throw new RecoveryError('cleanup');}
    throw error;
  }
}
async function snapshot(io: RecoveryIO, request: Parameters<typeof coldBackup>[0], bounds: RecoveryLimits, facts: Awaited<ReturnType<typeof openColdSource>>['captured']) {
  const p = sourcePaths(request.layout); const tree = new SnapshotTree(io, request.destination, {...bounds, maximumBytes: bounds.maximumBytes - CONTROL_ALLOWANCE});
  await tree.file(p.metadata, 'metadata.sqlite', 'metadata'); await tree.file(facts.journal, 'journal.sqlite', 'journal');
  await tree.file(p.installation, 'config/installation.json'); await tree.file(p.agent, 'config/agent.json');
  await tree.file(p.backendConnection, 'config/backend-agent.json');
  const outputs = await tree.published(join(p.backend, 'outputs/published'), 'outputs');
  const inputs = await tree.published(join(p.backend, 'inputs/published'), 'inputs');
  const header = captureRecoveryRecord({kind: 'header', format: 'beetle-cold-backup', version: 1,
    backupId: randomUUID(), installationId: facts.installationId, createdAt: new Date().toISOString(),
    metadataSchema: facts.metadataSchema, journalSchema: facts.journalSchema, journalAuthority: facts.journalAuthority,
    images: facts.images, quiescence: 'cold-terminal-only', roles: {metadata: 'metadata.sqlite', journal: 'journal.sqlite',
      installationConfig: 'config/installation.json', agentConfig: 'config/agent.json', outputs: outputs ? 'outputs' : null, inputs: inputs ? 'inputs' : null}}) as RecoveryHeader;
  const copied = tree.snapshot();
  await verifyReferences(io, request.destination, header, copied.entries, {options: facts.metadataOptions, maximum: bounds.maximumEntries});
  const footer = captureRecoveryRecord({kind: 'footer', files: copied.files, directories: copied.directories, bytes: copied.bytes});
  return writeManifest(io, join(request.destination, 'manifest.ndjson'), [header, ...copied.entries, footer], bounds.maximumBytes - CONTROL_ALLOWANCE - copied.bytes);
}
function seal(destination: string, backupId: string, manifestDigest: string): void {
  const path = join(destination, 'archive-control.sqlite');
  initializeHistoricalRecovery({path, historyId: backupId, operationId: backupId, manifestDigest});
  const lease = openBackendRecovery(path, backupId);
  try {lease.completeHistorical(backupId, manifestDigest, manifestDigest);} finally {lease.close();}
}
