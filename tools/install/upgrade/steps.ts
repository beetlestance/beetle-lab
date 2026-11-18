import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generationDigest } from '@beetle/contracts/installation-generation';
import type { ConfigurationGeneration } from '@beetle/contracts/installation-generation';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { openJournal } from '../../../agent/src/journal/index.js';
import type { Journal } from '../../../agent/src/journal/index.js';
import { openMetadata } from '../../../app/src/adapters/outbound/sqlite/index.js';
import { METADATA_SCHEMA_VERSION } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import { ProvisionError } from '../types.js';
import { canonical, check, digest } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
import { configurationStatePath, paths } from '../src/configuration.js';
import { PrivateFiles } from '../src/files.js';
import { readReceipt } from '../src/receipt.js';
import type { Receipt } from '../src/receipt.js';

function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
const withoutFence = (receipt: Receipt): Receipt => {
  const { upgradeFence: _fence, ...rest } = receipt;
  void _fence;
  return rest;
};
/**
 * Atomically replaces the ready selector. `fence` publishes the upgrade generation and the
 * fence in one rename; `activate` removes only the fence. The expected current selector
 * must be unchanged since it was read under the offline leases.
 */
export async function publishSelector(
  c: Captured,
  expected: Receipt,
  change: { kind: 'fence'; operationId: string; configurations: Record<string, unknown> } | { kind: 'activate' },
): Promise<Receipt> {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    await files.pin(join(c.request.root, 'config'));
    const current = await readReceipt(c, files);
    valid(canonical(current) === canonical(expected));
    let value: Receipt;
    let tag: string;
    if (change.kind === 'fence') {
      const intent = {
        version: 1 as const,
        operationId: change.operationId,
        installationId: current.installationId,
        previousDigest: c.requestDigest,
        configurations: change.configurations as ConfigurationGeneration['configurations'],
      };
      const generation = { ...intent, digest: generationDigest(intent, digest) };
      value = { ...withoutFence(current), generation, upgradeFence: change.operationId };
      tag = `${change.operationId}-upgrade`;
    } else {
      valid(current.upgradeFence !== undefined);
      value = withoutFence(current);
      tag = `${current.upgradeFence}-activate`;
    }
    await files.ready(value, tag, configurationStatePath(c.request.root), true);
    return value;
  } finally {
    await files.close();
  }
}
/** Opens the Journal through its public entrypoint (applying its own migrations) and approves the new profiles. */
export async function configureJournal(c: Captured, selector: Receipt, authority: string): Promise<void> {
  const loaded = await loadAgentConfiguration(
    { BEETLE_AGENT_CONFIG_FILE: paths(c.request.root).agent },
    c.context.agentWorkerUrl,
    c.context.signal,
    { baseline: true, receipt: selector },
  );
  let journal: Journal | undefined;
  try {
    const runtime = loaded.runtime;
    valid(runtime.installation.installationId === selector.installationId);
    journal = await openJournal(runtime.journal);
    check(c.context);
    valid((await journal.journalAuthority()) === authority);
    await journal.admission({
      kind: 'configure',
      configuration: { ...runtime.configuration, profiles: runtime.catalog.engines.map((engine) => engine.approved) },
    });
    check(c.context);
  } finally {
    await journal?.close();
    await loaded.close();
  }
}
/** Opens metadata through the backend adapter, which applies its forward migrations transactionally. */
export async function migrateMetadata(c: Captured, selector: Receipt): Promise<number> {
  const p = paths(c.request.root);
  const backend = await loadBackendConfiguration(
    {
      BEETLE_CONFIG_FILE: p.installation,
      BEETLE_AGENT_CONFIG_FILE: p.backendAgent,
      BEETLE_DATA_DIR: p.backendData,
      BEETLE_EXTERNAL_ORIGIN: c.request.externalOrigin,
    },
    c.context.backendWorkerUrl,
    { baseline: true, receipt: selector },
  );
  valid(backend.application.metadata.installation?.id === selector.installationId);
  const metadata = await openMetadata(backend.application.metadata);
  await metadata.close();
  check(c.context);
  const db = new DatabaseSync(join(p.backendData, 'metadata.sqlite'), { readOnly: true, timeout: 100 });
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    valid(version === METADATA_SCHEMA_VERSION);
    return version;
  } finally {
    db.close();
  }
}
