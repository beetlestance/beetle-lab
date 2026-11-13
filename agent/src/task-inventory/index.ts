import { mintObservation } from './observation.js';
import type { TaskPlanObservation } from './observation.js';
export type { TaskPlanObservation } from './observation.js';
import { PlanPersistence } from './persistence.js';
import { captureWindow } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { captureNativeCleanupPlan } from '../cleanup-control/index.js';
import type { NativeCleanupPlan, CleanupEntry } from '../cleanup-control/index.js';
import { nativeCustody, NativeCustodyError } from '../collection/native-custody/index.js';
import { OutputLifetime } from '../collection/output/index.js';
import { nodePorts, OutputFailure } from '../collection/output/index.js';
import type { OutputIO } from '../collection/output/index.js';
import type { OutputCollectionReason } from '../collection/output/index.js';
import { inventoryScope, inventoryAnchor } from './authority.js';
import type { InventoryAuthority } from './authority.js';
import { InventoryTree } from './tree.js';
import { inventoryPorts } from './ports.js';
import type { InventoryPorts } from './ports.js';
import { requireInventory, sameNative } from './checks.js';
export interface TaskInventoryOperation {
  readonly result: Promise<{ readonly ok: true; readonly plan: NativeCleanupPlan; readonly observation: TaskPlanObservation } | { readonly ok: false; readonly reason: OutputCollectionReason }>;
  readonly quiesced: Promise<void>; close(): Promise<void>;
}
function refused(reason: OutputCollectionReason = 'busy'): TaskInventoryOperation {
  const done = Promise.resolve(); return { result: Promise.resolve({ ok: false, reason }), quiesced: done, close: () => done };
}
function roles(entries: readonly CleanupEntry[], anchor: Awaited<ReturnType<typeof inventoryAnchor>>['anchor']): void {
  for (const role of ['task', 'input', 'output', 'secrets'] as const) {
    const found = entries.find(row => row.path === (role === 'task' ? '' : role));
    requireInventory(found?.kind === 'directory' && sameNative(found.native, anchor.directories[role]));
  }
}
/** Read-only checked observation. It grants no unlink/receipt/refund permission. */
export class TaskInventory {
  private readonly operations = new Set<TaskInventoryOperation>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly options: InventoryAuthority;
  private readonly persistence: PlanPersistence;
  constructor(options: InventoryAuthority) { this.options = Object.freeze({ ...options }); this.persistence = new PlanPersistence(this.options); }
  prepare(token: RuntimeAbsent, operation: Operation): TaskInventoryOperation { return this.prepareWithPorts(token, operation, inventoryPorts); }
  /** Trusted private fault seam; packaging always supplies the real Linux ports. */
  prepareWithPorts(token: RuntimeAbsent, operation: Operation, ports: InventoryPorts): TaskInventoryOperation {
    if (this.closed) return refused('closed'); const lease = nativeCustody.reserve('cleanup'); if (!lease) return refused();
    const owner = new OutputLifetime<{ readonly ok: true; readonly plan: NativeCleanupPlan }>(nodePorts, () => lease.release()); lease.own(owner);
    let tree: InventoryTree; let candidate: NativeCleanupPlan; let observation: TaskPlanObservation | undefined;
    const check = () => { owner.check(); inventoryScope(this.options, token); if (this.closed) throw new OutputFailure('closed'); };
    const io: OutputIO = { check, own: handle => owner.own(handle), closeHandles: handles => owner.closeHandles(handles),
      io: async action => { check(); const value = await action(); check(); return value; } };
    owner.start(() => {
      try {
        const budget = captureWindow(operation); const scope = inventoryScope(this.options, token); lease.bind(scope.directory);
        return { deadline: budget.deadline, ...(budget.signal ? { signal: budget.signal } : {}) };
      } catch (error) { throw new OutputFailure(error instanceof NativeCustodyError && error.reason === 'busy' ? 'busy' : 'invalid_options'); }
    }, async () => {
      const scope = await inventoryAnchor(this.options, token, io); check();
      tree = new InventoryTree(scope.directory, scope.anchor.directories.task, io, ports, scope.root);
      const entries = await tree.read(); check(); roles(entries, scope.anchor);
      const intent = scope.facts.intent;
      const plan = captureNativeCleanupPlan({ protocolVersion: 1, purpose: 'performance', original: scope.anchor.intent.original,
        namespaceIdentity: intent.namespaceIdentity, taskNamespaceIdentity: scope.anchor.taskNamespaceIdentity,
        retirementRequestDigest: intent.requestDigest, retirementVersion: 1, entries }); check();
      candidate = plan; return { ok: true, plan };
    }, async () => {
      await tree.namedCheck(); check(); observation = mintObservation({ plan: candidate, runtime: token,
        retirement: this.options.journal.retirements, plans: this.options.journal.cleanupPlans, open: () => !this.closed }); check();
    });
    const result: TaskInventoryOperation = { ...owner.public, result: owner.public.result.then(outcome => {
      if (!outcome.ok) return outcome; if (!observation) return { ok: false, reason: 'custody' };
      return { ...outcome, observation };
    }) }; this.operations.add(result);
    void result.quiesced.then(() => result.close().then(() => this.operations.delete(result), () => undefined)); return result;
  }
  persist(token: TaskPlanObservation, operation: Operation) { return this.persistence.persist(token, operation); }
  status() { return Object.freeze({ retained: this.operations.size, pendingPlans: this.persistence.status().retained, closed: this.closed }); }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    this.closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...this.operations].map(operation => operation.close()).concat([this.persistence.close()]));
      if (results.some(result => result.status === 'rejected')) throw new OutputFailure('io');
    }); return this.closing;
  }
}

/** Trusted read-only native adapters for exact-plan replay; no deletion authority. */
export { inventoryScope, inventoryAnchor } from './authority.js';
export type { InventoryAuthority } from './authority.js';
export { InventoryTree } from './tree.js';
export { InventoryRoot } from './installation.js';
export type { InventoryInstallation } from './installation.js';
export { inventoryPorts } from './ports.js';
export type { InventoryPorts } from './ports.js';
export { entry, nativeFact, requireInventory, sameNative, signature } from './checks.js';
