import { join } from 'node:path';
import { JOURNAL_SCHEMA_VERSION } from '../../../agent/src/journal/cold-inspection/index.js';
import { METADATA_SCHEMA_VERSION } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import { ProvisionError, UpgradeBlockedError } from '../types.js';
import { canonical } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
import { PrivateFiles } from '../src/files.js';
import { inspect } from '../src/inspection.js';
import { readReceipt } from '../src/receipt.js';
import type { Receipt } from '../src/receipt.js';
import { evaluate, imagePins } from '../src/selection.js';
import type { Evaluation } from '../src/selection.js';
import { takeBackup } from './backup.js';
import type { BackupLimits } from './backup.js';
import { privateDirectory } from './files.js';
import type { Operation } from './files.js';
import { acquireLeases, dockerBlockers, inspectSchemas } from './quiescence.js';
import type { ColdLeases } from './quiescence.js';
import { archiveUpgradeReceipt, operationDirectory, terminal, writeUpgradeReceipt } from './receipt.js';
import type { UpgradeReceipt, UpgradeStep } from './receipt.js';
import { configureJournal, migrateMetadata, publishSelector } from './steps.js';

export interface Installed {
  readonly receipt: Receipt;
  readonly evaluation: Evaluation;
}
/** Ready receipt plus fresh read-only facts; the caller decides what a difference means. */
export async function readInstalled(c: Captured): Promise<Installed> {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    await files.pin(join(c.request.root, 'config'));
    const receipt = await readReceipt(c, files);
    return { receipt, evaluation: await evaluate(c, files, receipt, await inspect(c)) };
  } finally {
    await files.close();
  }
}
export interface PrepareInput {
  readonly directory: string;
  readonly fresh: () => Captured;
  readonly copy: Operation;
  readonly extras: readonly { readonly name: string; readonly path: string }[];
  readonly limits: BackupLimits;
  readonly operationId: string;
}
type Progress = Omit<UpgradeReceipt, 'updatedAt'>;
async function quiescent(c: Captured, installed: Installed, leases: ColdLeases) {
  const { receipt, evaluation } = installed;
  const agent = evaluation.selection.selected['agent.json'] as { installation?: { expectedDaemonId?: unknown } };
  const schemas = inspectSchemas(c, receipt, leases.journalAuthority);
  const docker = await dockerBlockers(c, receipt.installationId, String(agent.installation?.expectedDaemonId));
  const blockers = [...docker, ...schemas.blockers];
  if (blockers.length) throw new UpgradeBlockedError(blockers);
  return schemas;
}
function begin(input: PrepareInput, installed: Installed, schemas: { metadataSchema: number; journalSchema: number }) {
  const { receipt, evaluation } = installed;
  return {
    version: 1 as const,
    operationId: input.operationId,
    installationId: receipt.installationId,
    phase: 'backing_up' as const,
    from: {
      pins: imagePins(evaluation.selection.selected['agent.json']),
      metadataSchema: schemas.metadataSchema,
      journalSchema: schemas.journalSchema,
    },
    to: {
      pins: imagePins(evaluation.expected['agent.json']),
      metadataSchema: METADATA_SCHEMA_VERSION,
      journalSchema: JOURNAL_SCHEMA_VERSION,
    },
    backup: null,
    steps: [],
  } satisfies Progress;
}
/** Images must not move again while an operation is open; a resume binds the recorded target. */
function bindTarget(progress: Progress, installed: Installed): void {
  const { receipt, evaluation } = installed;
  if (progress.installationId !== receipt.installationId) throw new ProvisionError('recovery_required');
  const configured = receipt.upgradeFence === progress.operationId;
  const target = imagePins(evaluation.expected['agent.json']);
  if (canonical(target) !== canonical(progress.to.pins)) throw new UpgradeBlockedError(['images_moved']);
  if (configured ? !evaluation.current : !evaluation.imagesMoved) throw new ProvisionError('recovery_required');
  if (receipt.upgradeFence !== undefined && !configured) throw new ProvisionError('recovery_required');
  if (configured && progress.backup === null) throw new ProvisionError('recovery_required');
}
async function backup(input: PrepareInput, progress: Progress, c: Captured): Promise<Progress> {
  const directory = operationDirectory(input.directory, progress.operationId);
  await privateDirectory(directory, true);
  const header = { operationId: progress.operationId, installationId: progress.installationId };
  const seal = await takeBackup(
    { root: c.request.root, extras: input.extras, directory, header },
    input.limits,
    input.copy,
  );
  return writeUpgradeReceipt(input.directory, { ...progress, phase: 'applying', backup: seal, steps: [] });
}
const record = (directory: string, progress: Progress, step: UpgradeStep) =>
  writeUpgradeReceipt(directory, { ...progress, steps: [...progress.steps, step] });
async function applySteps(input: PrepareInput, progress: Progress, installed: Installed): Promise<Progress> {
  let selector = installed.receipt;
  if (!progress.steps.includes('configuration')) {
    if (selector.upgradeFence !== progress.operationId)
      selector = await publishSelector(input.fresh(), selector, {
        kind: 'fence',
        operationId: progress.operationId,
        configurations: installed.evaluation.expected,
      });
    progress = await record(input.directory, progress, 'configuration');
  }
  if (!progress.steps.includes('journal')) {
    await configureJournal(input.fresh(), selector, selector.authority!);
    progress = await record(input.directory, progress, 'journal');
  }
  if (!progress.steps.includes('metadata')) {
    await migrateMetadata(input.fresh(), selector);
    progress = await record(input.directory, progress, 'metadata');
  }
  return writeUpgradeReceipt(input.directory, { ...progress, phase: 'awaiting_activation' });
}
/** With no open operation: current pins are `unchanged`; any drift but moved images is recovery. */
function settled({ receipt, evaluation }: Installed): boolean {
  if (evaluation.current && !receipt.upgradeFence) return true;
  if (!evaluation.imagesMoved) throw new ProvisionError('recovery_required');
  return false;
}
/**
 * Offline upgrade preparation. Order: leases and quiescence, durable receipt, sealed cold
 * backup, one atomic selector commit (new pins plus fence), Journal approval, metadata
 * migration, `awaiting_activation`. Every step is idempotent; a rerun resumes from the receipt.
 * Until the selector commit nothing in the installation has changed, so a resume before
 * that point retakes the backup instead of trusting an older one.
 */
export async function prepareUpgrade(
  input: PrepareInput,
  existing: UpgradeReceipt | undefined,
): Promise<UpgradeReceipt | 'unchanged'> {
  const c = input.fresh();
  const installed = await readInstalled(c);
  if (terminal(existing) && settled(installed)) return 'unchanged';
  const leases = acquireLeases(c, installed.receipt);
  try {
    const schemas = await quiescent(c, installed, leases);
    if (existing && terminal(existing)) await archiveUpgradeReceipt(input.directory, existing);
    let progress: Progress =
      existing && !terminal(existing)
        ? existing
        : await writeUpgradeReceipt(input.directory, begin(input, installed, schemas));
    bindTarget(progress, installed);
    if (installed.receipt.upgradeFence !== progress.operationId) progress = await backup(input, progress, c);
    return (await applySteps(input, progress, installed)) as UpgradeReceipt;
  } finally {
    leases.close();
  }
}
