import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { installationStatePath } from '../../../agent/src/bootstrap/index.js';
import { openRestoringState, InstallationStateError } from '../../../agent/src/installation-state/index.js';
import { inspectColdJournalForUpgrade } from '../../../agent/src/journal/cold-inspection/index.js';
import { inspectColdMetadataForUpgrade } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import { openBackendRecovery, RecoveryControlError } from '../../../app/src/bootstrap/recovery-control/index.js';
import { ProvisionError } from '../types.js';
import type { Captured } from '../src/capture.js';
import { check } from '../src/capture.js';
import { paths } from '../src/configuration.js';
import type { Receipt } from '../src/receipt.js';

/** Both offline startup leases; a serving owner holding either one is `conflict`. */
export interface ColdLeases {
  readonly journalAuthority: string;
  close(): void;
}
function owned(error: unknown): boolean {
  return (
    (error instanceof RecoveryControlError || error instanceof InstallationStateError) &&
    (error.code === 'owned' || error.code === 'closed')
  );
}
export function acquireLeases(c: Captured, receipt: Receipt): ColdLeases {
  const p = paths(c.request.root);
  let backend: ReturnType<typeof openBackendRecovery> | undefined;
  try {
    backend = openBackendRecovery(join(p.backendData, 'recovery-control.sqlite'), receipt.installationId);
    if (backend.snapshot().phase !== 'ready') throw new ProvisionError('recovery_required');
    const agent = openRestoringState(installationStatePath(join(p.agentJournal, 'journal.sqlite')));
    const state = agent.snapshot();
    if (state.phase !== 'ready' || state.authority !== receipt.authority) {
      agent.close();
      throw new ProvisionError('recovery_required');
    }
    const lease = backend;
    return Object.freeze({
      journalAuthority: state.authority,
      close: () => {
        agent.close();
        lease.close();
      },
    });
  } catch (error) {
    backend?.close();
    if (owned(error)) throw new ProvisionError('conflict', { cause: error });
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError('recovery_required', { cause: error });
  }
}
function readOnly<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 100, defensive: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    return read(db);
  } finally {
    db.close();
  }
}
export interface ColdSchemas {
  readonly metadataSchema: number;
  readonly journalSchema: number;
  readonly blockers: readonly string[];
}
/** Read-only schema and terminal-state facts under both leases; never migrates or repairs. */
export function inspectSchemas(c: Captured, receipt: Receipt, authority: string): ColdSchemas {
  const p = paths(c.request.root);
  try {
    const metadata = readOnly(join(p.backendData, 'metadata.sqlite'), (db) =>
      inspectColdMetadataForUpgrade(db, receipt.installationId),
    );
    const journal = readOnly(join(p.agentJournal, 'journal.sqlite'), (db) =>
      inspectColdJournalForUpgrade(db, authority),
    );
    return {
      metadataSchema: metadata.schema,
      journalSchema: journal.schema,
      blockers: [...metadata.blockers, ...journal.blockers],
    };
  } catch (cause) {
    throw new ProvisionError('recovery_required', { cause });
  }
}
async function get(c: Captured, path: string): Promise<{ status: number; body: unknown }> {
  check(c.context);
  const reply = await c.context.docker.request({
    method: 'GET',
    path,
    deadline: c.context.deadline,
    signal: c.context.signal,
  });
  check(c.context);
  if (!reply.ok) throw new ProvisionError('inspection');
  return { status: reply.status, body: reply.body };
}
const live = (state: unknown) => state === 'running' || state === 'restarting' || state === 'paused';
/** Read-only daemon facts: same daemon, no live engine attempt and no live agent container. */
export async function dockerBlockers(c: Captured, installationId: string, daemonId: string): Promise<string[]> {
  const blockers: string[] = [];
  const info = await get(c, '/v1.47/info');
  if ((info.body as { ID?: unknown } | null)?.ID !== daemonId) blockers.push('docker_daemon');
  if (await liveEngines(c, installationId)) blockers.push('engine_containers');
  if (await liveAgent(c)) blockers.push('agent_container');
  return blockers;
}
async function liveEngines(c: Captured, installationId: string): Promise<boolean> {
  const filter = encodeURIComponent(JSON.stringify({ label: [`dev.beetle.installation=${installationId}`] }));
  const engines = await get(c, `/v1.47/containers/json?all=1&filters=${filter}`);
  if (engines.status !== 200 || !Array.isArray(engines.body) || engines.body.length > 4096)
    throw new ProvisionError('inspection');
  return engines.body.some((item) => live((item as { State?: unknown } | null)?.State));
}
/** A created-but-not-started agent (Compose creates every container before setup exits) is not live. */
async function liveAgent(c: Captured): Promise<boolean> {
  const agent = await get(c, `/v1.47/containers/${encodeURIComponent(c.request.agentContainer)}/json`);
  if (agent.status === 404) return false;
  if (agent.status !== 200) throw new ProvisionError('inspection');
  return live((agent.body as { State?: { Status?: unknown } } | null)?.State?.Status);
}
