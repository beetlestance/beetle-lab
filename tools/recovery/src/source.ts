import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadAgentConfiguration, installationStatePath } from '../../../agent/src/bootstrap/index.js';
import { openRestoringState } from '../../../agent/src/installation-state/index.js';
import { inspectColdJournal, matchColdRuntime } from '../../../agent/src/journal/cold-inspection/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import { openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import { inspectColdMetadata } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import type { DockerTransport } from '../../../agent/src/backends/docker/index.js';
import { directory, regular } from './files.js';
import { relativePath, sourcePaths } from './layout.js';
import type { SourceLayout } from './layout.js';
import type { RecoveryIO } from './io.js';
import { RecoveryError } from './types.js';
import { inspectPhysical } from './physical.js';
const stranded = new Set<unknown>();
export interface SourceContext {readonly agentWorkerUrl: URL; readonly metadataWorkerUrl: URL; readonly docker?: DockerTransport}
/** Leases are returned to the coordinator; close them only after every other owner drains. */
export async function openColdSource(io: RecoveryIO, layout: SourceLayout, context: SourceContext) {
  const p = sourcePaths(layout); await directory(io, p.root); await directory(io, p.backend);
  const loaded = await io.acquire(() => loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE: p.agent}, context.agentWorkerUrl, io.operation.signal), value => value.close());
  const runtime = loaded.value.runtime;
  relativePath(p.root, runtime.journal.path);
  const backend = await io.issue(() => loadBackendConfiguration({BEETLE_CONFIG_FILE: p.installation, BEETLE_AGENT_CONFIG_FILE: p.backendConnection,
    BEETLE_DATA_DIR: p.backend, BEETLE_EXTERNAL_ORIGIN: 'http://127.0.0.1:4311'}, context.metadataWorkerUrl));
  const installationId = backend.application.metadata.installation.id;
  if (runtime.installation.installationId !== installationId) throw new RecoveryError('integrity');
  const backendLease = openBackendRecovery(join(p.backend, 'recovery-control.sqlite'), installationId);
  let agentLease: ReturnType<typeof openRestoringState> | undefined;
  try {
    if (backendLease.snapshot().phase !== 'ready') throw new RecoveryError('not_cold');
    agentLease = openRestoringState(installationStatePath(runtime.journal.path));
    const state = agentLease.snapshot(); if (state.phase !== 'ready') throw new RecoveryError('not_cold');
    for (const path of [p.metadata, runtime.journal.path]) {await directory(io, dirname(path)); regular(await io.issue(() => lstat(path, {bigint: true})), Number.MAX_SAFE_INTEGER, false);}
    const metadata = io.acquireSync(() => new DatabaseSync(p.metadata, {readOnly: true, timeout: 100, defensive: true}), db => db.close());
    const journal = io.acquireSync(() => new DatabaseSync(runtime.journal.path, {readOnly: true, timeout: 100, defensive: true}), db => db.close());
    metadata.value.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    journal.value.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    const appFacts = inspectColdMetadata(metadata.value, installationId); const agentFacts = inspectColdJournal(journal.value, state.authority);
    const physical = await inspectPhysical({transport: context.docker ?? runtime.transport, operation: io.operation, installationId,
      daemonId: runtime.installation.expectedDaemonId, agentContainer: runtime.installation.agentContainer, agentImage: runtime.installation.agentImageId, matchRuntime: key => matchColdRuntime(journal.value, key)});
    await io.close(metadata); await io.close(journal);
    const images = [...new Set([runtime.installation.agentImageId, ...runtime.catalog.engines.map(engine => engine.profile.imageDigest)])];
    const captured = {installationId, metadataSchema: appFacts.schema, journalSchema: agentFacts.schema,
      journalAuthority: agentFacts.journalAuthority, images, physical, installation: backend.application.metadata.installation,
      journal: runtime.journal.path, metadataOptions: backend.application.metadata};
    await io.close(loaded);
    return {captured, backendLease, agentLease};
  } catch (error) {
    // Do not release startup exclusion until original config/database owners settle.
    try {
      await io.closeAll();
      // Acquisition can have retained uncertain native custody internally. Keep the
      // already acquired backend lease until process exit when no agent lease returned.
      if (!agentLease) {stranded.add(backendLease); throw new RecoveryError('cleanup');}
      agentLease.close(); backendLease.close();
    } catch {stranded.add({backendLease, agentLease, io}); throw new RecoveryError('cleanup');}
    throw error;
  }
}
