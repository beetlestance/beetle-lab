import { join, isAbsolute, normalize, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { INSTALLATION_RECEIPT_BYTES } from '@beetle/contracts/installation-generation';
import { validatePrimitive } from '@beetle/contracts';
import { BindingChangedError, OriginBlockedError, ProvisionError } from '../types.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { canonical, capture } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
import { configurationStatePath } from '../src/configuration.js';
import { PrivateFiles } from '../src/files.js';
import { validOrigin } from '../src/origin-selector.js';
import type { OriginSelector } from '../src/origin-selector.js';
import { parse, readReceipt } from '../src/receipt.js';
import type { Receipt } from '../src/receipt.js';
import { acquireLeases, dockerBlockers } from '../upgrade/quiescence.js';
import { readUpgradeReceipt, terminal } from '../upgrade/receipt.js';
import { MAX_ORIGIN_OPERATIONS, pendingOperation, readOriginRecords, writeOriginRecords } from './records.js';
import type { OriginOperation, OriginRecords } from './records.js';

export interface OriginChangeInput {
  /** The installed request: `installedRequest` resolved with `from` as its origin. */
  readonly request: ProvisionRequest;
  /** The origin the installation serves now; a compare-and-set guard. */
  readonly from: string;
  /** The new origin, already checked against the access and bind rules of setup. */
  readonly to: string;
  readonly operationId: string;
  /** Private directories outside the root: origin records and upgrade receipts. */
  readonly originDirectory: string;
  readonly upgradeDirectory: string;
}
export interface OriginChangeResult {
  readonly installationId: string;
  readonly operationId: string;
  readonly status: 'changed' | 'unchanged';
}
let active = false;
function outside(directory: string, root: string): string {
  const away = (a: string, b: string) => relative(a, b).startsWith('..');
  if (!isAbsolute(directory) || normalize(directory) !== directory || !away(root, directory) || !away(directory, root))
    throw new ProvisionError('invalid_input');
  return directory;
}
/** Reads the selector raw first so an unfinished capacity change is named rather than reported as damage. */
async function installed(c: Captured): Promise<Receipt> {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    await files.pin(join(c.request.root, 'config'));
    const baseline = parse(await files.read(join(c.request.root, 'installation.json'), INSTALLATION_RECEIPT_BYTES));
    const selector = parse(await files.read(configurationStatePath(c.request.root), INSTALLATION_RECEIPT_BYTES));
    if ((selector as { phase?: unknown } | null)?.phase !== 'ready') throw new OriginBlockedError(['capacity_change']);
    // The installation was not recorded with `from`: the guard fails before any lease or write.
    if ((baseline as { requestDigest?: unknown } | null)?.requestDigest !== c.requestDigest)
      throw new BindingChangedError(['external_origin']);
    return await readReceipt(c, files);
  } finally {
    await files.close();
  }
}
/** One atomic selector rename, refused if the selector moved since it was read under the leases. */
async function publishOrigin(c: Captured, expected: Receipt, origin: OriginSelector | undefined, operationId: string) {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    await files.pin(join(c.request.root, 'config'));
    const current = await readReceipt(c, files);
    if (canonical(current) !== canonical(expected)) throw new ProvisionError('conflict');
    const { origin: _previous, ...rest } = current;
    void _previous;
    const value: Receipt = origin ? { ...rest, origin } : rest;
    await files.ready(value, `${operationId}-origin`, configurationStatePath(c.request.root), true);
  } finally {
    await files.close();
  }
}
async function blockers(c: Captured, receipt: Receipt, upgradeDirectory: string): Promise<void> {
  const upgrade = await readUpgradeReceipt(upgradeDirectory);
  if (receipt.upgradeFence !== undefined || !terminal(upgrade)) throw new OriginBlockedError(['upgrade']);
  // The daemon pin is not this operation's concern; live work and a live agent are.
  const live = (await dockerBlockers(c, receipt.installationId, '')).filter((item) => item !== 'docker_daemon');
  if (live.length) throw new OriginBlockedError(live);
}
interface Plan {
  readonly records: OriginRecords;
  readonly operation: OriginOperation;
}
/** Decides from the records and the selector; never writes. `undefined` means already committed. */
function plan(input: OriginChangeInput, records: OriginRecords, current: string): Plan | undefined {
  const existing = records.operations.find((item) => item.operationId === input.operationId);
  if (existing) {
    if (existing.from !== input.from || existing.to !== input.to) throw new ProvisionError('conflict');
    if (existing.phase === 'committed') return undefined;
    if (current !== input.from && current !== input.to) throw new ProvisionError('recovery_required');
    return { records, operation: existing };
  }
  if (pendingOperation(records)) throw new OriginBlockedError(['origin_change_pending']);
  if (current !== input.from) throw new BindingChangedError(['external_origin']);
  if (records.operations.length >= MAX_ORIGIN_OPERATIONS) throw new OriginBlockedError(['origin_history_full']);
  const operation: OriginOperation = {
    operationId: input.operationId,
    from: input.from,
    to: input.to,
    phase: 'pending',
  };
  return { records: { ...records, operations: [...records.operations, operation] }, operation };
}
async function apply(c: Captured, input: OriginChangeInput, receipt: Receipt): Promise<OriginChangeResult> {
  const describe = (status: OriginChangeResult['status']) =>
    Object.freeze({ installationId: receipt.installationId, operationId: input.operationId, status });
  const baseline = receipt.origin?.baseline ?? c.request.externalOrigin;
  const current = receipt.origin?.current ?? c.request.externalOrigin;
  const records = await readOriginRecords(input.originDirectory, receipt.installationId);
  const decided = plan(input, records, current);
  if (!decided) return describe('unchanged');
  await writeOriginRecords(input.originDirectory, decided.records);
  if (current !== input.to) {
    const origin =
      input.to === baseline
        ? undefined
        : { version: 1 as const, operationId: input.operationId, baseline, current: input.to };
    await publishOrigin(c, receipt, origin, input.operationId);
  }
  const operations = decided.records.operations.map((item) =>
    item.operationId === input.operationId ? { ...item, phase: 'committed' as const } : item,
  );
  await writeOriginRecords(input.originDirectory, { ...decided.records, operations });
  return describe('changed');
}
/**
 * Offline origin change (decision 032 amendment). Services stopped, both startup leases held,
 * no unfinished upgrade or capacity change. Suites, runs, credentials and settings are not
 * read or written; only the selector's `origin` field and the host-side records change.
 */
export async function changeInstallationOrigin(
  input: OriginChangeInput,
  context: ProvisionContext,
): Promise<OriginChangeResult> {
  if (
    !validatePrimitive('uuid', input.operationId).ok ||
    !validOrigin(input.from) ||
    !validOrigin(input.to) ||
    input.from === input.to
  )
    throw new ProvisionError('invalid_input');
  outside(input.originDirectory, input.request.root);
  outside(input.upgradeDirectory, input.request.root);
  if (active) throw new ProvisionError('conflict');
  active = true;
  try {
    const c = capture(input.request, { ...context, deadline: Math.min(context.deadline, performance.now() + 30_000) });
    const receipt = await installed(c);
    const leases = acquireLeases(c, receipt);
    try {
      await blockers(c, receipt, input.upgradeDirectory);
      return await apply(c, input, receipt);
    } finally {
      leases.close();
    }
  } finally {
    active = false;
  }
}
