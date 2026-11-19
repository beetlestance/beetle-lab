import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { ProvisionError, UpgradeBlockedError } from '../types.js';
import { capture, check } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
import { PrivateFiles } from '../src/files.js';
import { readReceipt } from '../src/receipt.js';
import type { ImagePins } from '../src/selection.js';
import { prepareUpgrade, readInstalled } from './apply.js';
import { defaultBackupLimits, readManifest, restoreInto } from './backup.js';
import type { BackupLimits } from './backup.js';
import { privateDirectory, stat, syncDirectory, upgradeNative } from './files.js';
import type { Operation } from './files.js';
import { acquireLeases, dockerBlockers } from './quiescence.js';
import { operationDirectory, readUpgradeReceipt, terminal, writeUpgradeReceipt } from './receipt.js';
import { publishSelector } from './steps.js';
import { originChangePending } from '../origin/records.js';
import type { UpgradeReceipt } from './receipt.js';
export { UpgradeBlockedError } from '../types.js';
export type { UpgradeReceipt, UpgradePhase } from './receipt.js';

export type UpgradeAction = 'prepare' | 'status' | 'activate' | 'rollback';
export interface UpgradeInput {
  readonly request: ProvisionRequest;
  readonly action: UpgradeAction;
  /** Private directory outside the installation root on the same filesystem. */
  readonly upgradeDirectory: string;
  readonly extras?: readonly { readonly name: string; readonly path: string }[];
  readonly limits?: BackupLimits;
  /** Origin-change records; a pending origin change blocks a new upgrade. */
  readonly originDirectory?: string;
}
/** `context.deadline` bounds the whole operation; each configuration step still gets at most 30 s. */
export interface UpgradeResult {
  readonly installationId: string | null;
  readonly status: 'none' | 'unchanged' | UpgradeReceipt['phase'];
  readonly operationId?: string;
  readonly from?: ImagePins;
  readonly to?: ImagePins;
  readonly steps?: readonly string[];
}
let active = false;
function describe(receipt: UpgradeReceipt | undefined): UpgradeResult {
  if (!receipt) return Object.freeze({ installationId: null, status: 'none' });
  const { installationId, operationId, phase: status, from, to, steps } = receipt;
  return Object.freeze({ installationId, operationId, status, from: from.pins, to: to.pins, steps });
}
function directoryFor(input: UpgradeInput): string {
  const directory = input.upgradeDirectory;
  const root = input.request.root;
  const outside = (a: string, b: string) => relative(a, b).startsWith('..');
  if (
    typeof directory !== 'string' ||
    !isAbsolute(directory) ||
    normalize(directory) !== directory ||
    !outside(root, directory) ||
    !outside(directory, root)
  )
    throw new ProvisionError('invalid_input');
  return directory;
}
interface Session {
  readonly input: UpgradeInput;
  readonly directory: string;
  readonly fresh: () => Captured;
  readonly copy: Operation;
}
async function activate(session: Session, existing: UpgradeReceipt | undefined): Promise<UpgradeResult> {
  if (existing?.phase === 'activated') return describe(existing);
  if (existing?.phase !== 'awaiting_activation') throw new UpgradeBlockedError(['not_awaiting_activation']);
  const c = session.fresh();
  const { receipt, evaluation } = await readInstalled(c);
  const leases = acquireLeases(c, receipt);
  try {
    if (!evaluation.current) throw new ProvisionError('recovery_required');
    if (receipt.upgradeFence === existing.operationId)
      await publishSelector(session.fresh(), receipt, { kind: 'activate' });
    else if (receipt.upgradeFence !== undefined || receipt.generation?.operationId !== existing.operationId)
      throw new ProvisionError('recovery_required');
    return describe(await writeUpgradeReceipt(session.directory, { ...existing, phase: 'activated' }));
  } finally {
    leases.close();
  }
}
async function swap(root: string, replaced: string, staging: string): Promise<void> {
  if (await stat(root)) {
    await upgradeNative.rename(root, replaced);
    await syncDirectory(dirname(root));
    await syncDirectory(dirname(replaced));
  }
  await upgradeNative.rename(staging, root);
  await syncDirectory(dirname(root));
  await syncDirectory(dirname(staging));
}
async function installedReceipt(c: Captured) {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    return await readReceipt(c, files);
  } finally {
    await files.close();
  }
}
async function restoreAndSwap(session: Session, existing: UpgradeReceipt, paths: Record<string, string>) {
  const manifest = await readManifest(paths.directory!, existing.backup!);
  if (manifest.installationId !== existing.installationId || manifest.operationId !== existing.operationId)
    throw new ProvisionError('recovery_required');
  const c = session.fresh();
  const receipt = await installedReceipt(c);
  if (receipt.installationId !== existing.installationId) throw new ProvisionError('recovery_required');
  const leases = acquireLeases(c, receipt);
  try {
    // Rollback needs stopped containers, not the daemon pin of either generation.
    const blockers = (await dockerBlockers(c, receipt.installationId, '')).filter((item) => item !== 'docker_daemon');
    if (blockers.length) throw new UpgradeBlockedError(blockers);
    if (existing.phase !== 'rolling_back')
      await writeUpgradeReceipt(session.directory, { ...existing, phase: 'rolling_back' });
    await restoreInto(paths.directory!, manifest, paths.staging!, session.copy);
    check(c.context);
    await swap(c.request.root, paths.replaced!, paths.staging!);
  } finally {
    leases.close();
  }
}
/** Completes an interrupted swap from the on-disk state, or restores and swaps afresh. */
async function restore(session: Session, existing: UpgradeReceipt): Promise<void> {
  const root = session.input.request.root;
  const directory = operationDirectory(session.directory, existing.operationId);
  const paths = { directory, replaced: join(directory, 'replaced'), staging: join(directory, 'restore.partial') };
  const [present, replaced, staging] = await Promise.all([stat(root), stat(paths.replaced), stat(paths.staging)]);
  const swapping = existing.phase === 'rolling_back' && replaced !== undefined;
  if (swapping && staging && !present) return swap(root, paths.replaced, paths.staging);
  if (swapping && present && !staging) return;
  if (!present || replaced) throw new ProvisionError('recovery_required');
  await restoreAndSwap(session, existing, paths);
}
/**
 * Pre-activation rollback restores the sealed backup of the whole root all-or-nothing: a
 * verified copy is built beside it and swapped in with two renames recorded under
 * `rolling_back`; a rerun completes an interrupted swap. Refused after activation.
 */
async function rollback(session: Session, existing: UpgradeReceipt | undefined): Promise<UpgradeResult> {
  if (!existing || existing.phase === 'activated')
    throw new UpgradeBlockedError([existing ? 'activated' : 'no_pending_upgrade']);
  if (existing.phase === 'rolled_back') return describe(existing);
  // Before the backup is sealed nothing in the installation has changed.
  if (existing.phase !== 'backing_up') await restore(session, existing);
  return describe(await writeUpgradeReceipt(session.directory, { ...existing, phase: 'rolled_back' }));
}
async function dispatch(session: Session): Promise<UpgradeResult> {
  await privateDirectory(session.directory, true);
  const existing = await readUpgradeReceipt(session.directory);
  switch (session.input.action) {
    case 'status':
      return describe(existing);
    case 'activate':
      return activate(session, existing);
    case 'rollback':
      return rollback(session, existing);
    case 'prepare':
      return prepare(session, existing);
    default:
      throw new ProvisionError('invalid_input');
  }
}
/** An interrupted `setup origin` finishes first; its records live outside the root. */
async function refuseOriginChange(session: Session): Promise<void> {
  if (!session.input.originDirectory) return;
  const { installationId } = await installedReceipt(session.fresh());
  if (await originChangePending(session.input.originDirectory, installationId))
    throw new UpgradeBlockedError(['origin_change']);
}
async function prepare(session: Session, existing: UpgradeReceipt | undefined): Promise<UpgradeResult> {
  if (existing?.phase === 'awaiting_activation') return describe(existing);
  if (existing?.phase === 'rolling_back') throw new UpgradeBlockedError(['rollback_pending']);
  if (terminal(existing)) await refuseOriginChange(session);
  const prepared = await prepareUpgrade(
    {
      directory: session.directory,
      fresh: session.fresh,
      copy: session.copy,
      extras: session.input.extras ?? [],
      limits: session.input.limits ?? defaultBackupLimits,
      operationId: randomUUID(),
    },
    existing,
  );
  if (prepared !== 'unchanged') return describe(prepared);
  const receipt = await installedReceipt(session.fresh());
  return Object.freeze({ installationId: receipt.installationId, status: 'unchanged' });
}
/** Explicit offline upgrade entrypoint; one operation per process. Services must be stopped. */
export async function upgradeInstallation(input: UpgradeInput, context: ProvisionContext): Promise<UpgradeResult> {
  const directory = directoryFor(input);
  const fresh = () =>
    capture(input.request, { ...context, deadline: Math.min(context.deadline, performance.now() + 30_000) });
  fresh();
  if (active) throw new ProvisionError('conflict');
  active = true;
  try {
    return await dispatch({ input, directory, fresh, copy: { signal: context.signal, deadline: context.deadline } });
  } finally {
    active = false;
  }
}
