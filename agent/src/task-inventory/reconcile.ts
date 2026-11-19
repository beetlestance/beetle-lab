import { constants } from 'node:fs';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import { captureTaskReconciliation } from '../staging-namespace/index.js';
import type { TaskDirectoryFacts, TaskReconciliation } from '../staging-namespace/index.js';
import { OutputFailure } from '../collection/output/index.js';
import type { OutputCollectionReason, OutputIO } from '../collection/output/index.js';
import { inventoryAnchor } from './authority.js';
import type { InventoryAuthority } from './authority.js';
import { InventoryRoot } from './installation.js';
import { InventoryTree } from './tree.js';
import type { InventoryPorts } from './ports.js';
import { nativeFact, requireInventory } from './checks.js';
const roles = ['task', 'input', 'output', 'secrets'] as const;
/** `current`: the folders already match the facts cleanup checks against; nothing to record. */
export type ReconcileOutcome =
  { readonly state: 'current' } | { readonly state: 'reconciled'; readonly reconciliation: TaskReconciliation };
export interface TaskReconcileOperation {
  readonly result: Promise<
    | { readonly ok: true; readonly outcome: ReconcileOutcome }
    | { readonly ok: false; readonly reason: OutputCollectionReason }
  >;
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
export interface ReconcileObservation {
  readonly outcome: ReconcileOutcome;
  readonly tree: InventoryTree;
}
export function refusedReconcile(reason: OutputCollectionReason): TaskReconcileOperation {
  const done = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason }), quiesced: done, close: () => done };
}
function same(left: TaskDirectoryFacts, right: TaskDirectoryFacts): boolean {
  return encodeCanonicalJson(left, 4096) === encodeCanonicalJson(right, 4096);
}
/**
 * The folder is found by its recorded name under this start's verified root, opened without
 * following links, and must sit on the live root's device. The whole tree is then read with the
 * same checks as cleanup inventory (one device, owner and group; directories 0700; regular single-
 * link files 0400/0600; no links or special files). Owner, group and mode of the four folders must
 * equal the recorded facts; captureTaskReconciliation refuses otherwise.
 */
export async function observeReconciliation(
  options: InventoryAuthority,
  token: RuntimeAbsent,
  io: OutputIO,
  ports: InventoryPorts,
  check: () => void,
): Promise<ReconcileObservation> {
  const scope = await inventoryAnchor(options, token, io);
  check();
  requireInventory(ports.platform === 'linux');
  const { organizationId, workspaceId, attemptId, generation } = scope.facts.intent.request;
  const plan = await io.io(() =>
    options.journal.cleanupPlans.read({ organizationId, workspaceId, attemptId, generation }),
  );
  // Facts observed before reconciliation must never become removal authority for new files.
  if (plan) throw new OutputFailure('custody');
  check();
  const installed = new InventoryRoot(scope.root, io, ports);
  const root = await installed.open();
  let candidate;
  try {
    const name = scope.directory.slice(scope.directory.lastIndexOf('/') + 1);
    const handle = await io.io(() =>
      ports
        .open(
          ports.child(root, name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_DIRECTORY,
        )
        .then((value) => {
          io.own(value);
          return value;
        }),
    );
    try {
      candidate = nativeFact(await io.io(() => handle.stat({ bigint: true })));
    } finally {
      await io.closeHandles([handle]);
    }
  } finally {
    await io.closeHandles([root]);
  }
  check();
  requireInventory(candidate.dev === scope.root.native.dev);
  const tree = new InventoryTree(scope.directory, candidate, io, ports, scope.root);
  const entries = await tree.read();
  check();
  const found = Object.fromEntries(
    roles.map((role) => {
      const row = entries.find((entry) => entry.path === (role === 'task' ? '' : role));
      requireInventory(row?.kind === 'directory');
      return [role, row.native];
    }),
  ) as unknown as TaskDirectoryFacts;
  if (same(found, scope.directories)) return { outcome: { state: 'current' }, tree };
  let reconciliation: TaskReconciliation;
  try {
    reconciliation = captureTaskReconciliation(
      {
        protocolVersion: 1,
        taskNamespaceIdentity: scope.anchor.taskNamespaceIdentity,
        retirementRequestDigest: scope.facts.intent.requestDigest,
        directories: found,
      },
      scope.anchor,
    );
  } catch {
    throw new OutputFailure('custody');
  }
  return { outcome: { state: 'reconciled', reconciliation }, tree };
}
