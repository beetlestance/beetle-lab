import { cleanupAccess, CleanupAccessError } from '../cleanup-access/index.js';
import type { CleanupLease } from '../cleanup-access/index.js';
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
import type { TaskDirectoryFacts } from '../staging-namespace/index.js';
import { observeReconciliation, refusedReconcile } from './reconcile.js';
import type { ReconcileObservation, ReconcileOutcome, TaskReconcileOperation } from './reconcile.js';
export type { ReconcileOutcome, TaskReconcileOperation } from './reconcile.js';
export interface TaskInventoryOperation {
  readonly result: Promise<
    | { readonly ok: true; readonly plan: NativeCleanupPlan; readonly observation: TaskPlanObservation }
    | { readonly ok: false; readonly reason: OutputCollectionReason }
  >;
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
function refused(reason: OutputCollectionReason = 'busy'): TaskInventoryOperation {
  const done = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason }), quiesced: done, close: () => done };
}
function roles(entries: readonly CleanupEntry[], directories: TaskDirectoryFacts): void {
  for (const role of ['task', 'input', 'output', 'secrets'] as const) {
    const found = entries.find((row) => row.path === (role === 'task' ? '' : role));
    requireInventory(found?.kind === 'directory' && sameNative(found.native, directories[role]));
  }
}
/** Read-only checked observation. It grants no unlink/receipt/refund permission. */
export class TaskInventory {
  private readonly operations = new Map<Pick<TaskInventoryOperation, 'close'>, Promise<void>>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly options: InventoryAuthority;
  private readonly persistence: PlanPersistence;
  constructor(options: InventoryAuthority) {
    this.options = Object.freeze({ ...options });
    this.persistence = new PlanPersistence(this.options);
  }
  prepare(token: RuntimeAbsent, operation: Operation): TaskInventoryOperation {
    return this.prepareWithPorts(token, operation, inventoryPorts);
  }
  /** Trusted private fault seam; packaging always supplies the real Linux ports. */
  prepareWithPorts(token: RuntimeAbsent, operation: Operation, ports: InventoryPorts): TaskInventoryOperation {
    let tree: InventoryTree;
    let candidate: NativeCleanupPlan;
    let observation: TaskPlanObservation | undefined;
    const started = this.run<{ readonly ok: true; readonly plan: NativeCleanupPlan }>(token, operation, {
      body: async (io, check) => {
        const scope = await inventoryAnchor(this.options, token, io);
        check();
        tree = new InventoryTree(scope.directory, scope.directories.task, io, ports, scope.root);
        const entries = await tree.read();
        check();
        roles(entries, scope.directories);
        const intent = scope.facts.intent;
        const plan = captureNativeCleanupPlan({
          protocolVersion: 1,
          purpose: 'performance',
          original: scope.anchor.intent.original,
          namespaceIdentity: intent.namespaceIdentity,
          taskNamespaceIdentity: scope.anchor.taskNamespaceIdentity,
          retirementRequestDigest: intent.requestDigest,
          retirementVersion: 1,
          entries,
        });
        check();
        candidate = plan;
        return { ok: true, plan };
      },
      after: async (check) => {
        await tree.namedCheck();
        check();
        observation = mintObservation({
          plan: candidate,
          runtime: token,
          retirement: this.options.journal.retirements,
          plans: this.options.journal.cleanupPlans,
          open: () => !this.closed,
        });
        check();
      },
    });
    if (!started.ok) return refused(started.reason);
    const result: TaskInventoryOperation = {
      ...started.operation,
      result: started.operation.result.then((outcome) => {
        if (!outcome.ok) return outcome;
        const observed = observation;
        if (!observed) return { ok: false, reason: 'custody' };
        return { ...outcome, observation: observed };
      }),
    };
    return result;
  }
  reconcile(token: RuntimeAbsent, operation: Operation): TaskReconcileOperation {
    return this.reconcileWithPorts(token, operation, inventoryPorts);
  }
  /**
   * Observes the task folders again for reconciliation (decision 030): same custody, lease and
   * tree checks as prepare, rooted at the folder found under this start's verified root. The
   * result is an observation only; the caller records it through the Journal, which refuses once
   * a cleanup plan exists. No unlink, plan or receipt authority is granted here.
   */
  reconcileWithPorts(token: RuntimeAbsent, operation: Operation, ports: InventoryPorts): TaskReconcileOperation {
    let observed: ReconcileObservation | undefined;
    const started = this.run<{ readonly ok: true; readonly outcome: ReconcileOutcome }>(token, operation, {
      body: async (io, check) => {
        observed = await observeReconciliation(this.options, token, io, ports, check);
        return { ok: true, outcome: observed.outcome };
      },
      after: async (check) => {
        await observed?.tree.namedCheck();
        check();
      },
    });
    if (!started.ok) return refusedReconcile(started.reason);
    return started.operation;
  }
  private run<T extends { readonly ok: true }>(
    token: RuntimeAbsent,
    operation: Operation,
    steps: { body(io: OutputIO, check: () => void): Promise<T>; after(check: () => void): Promise<void> },
  ):
    | { readonly ok: true; readonly operation: OutputLifetime<T>['public'] }
    | { readonly ok: false; readonly reason: OutputCollectionReason } {
    if (this.closed) return { ok: false, reason: 'closed' };
    let access: CleanupLease;
    try {
      access = cleanupAccess(this.options.journal.retirements).acquire(
        inventoryScope(this.options, token).facts.intent.request,
      );
    } catch (error) {
      return { ok: false, reason: error instanceof CleanupAccessError ? 'busy' : 'invalid_options' };
    }
    const lease = nativeCustody.reserve('cleanup');
    if (!lease) {
      access.release();
      return { ok: false, reason: 'busy' };
    }
    const owner = new OutputLifetime<T>(nodePorts, () => lease.release());
    lease.own(owner);
    let carrierUnknown = false;
    const check = () => {
      owner.check();
      inventoryScope(this.options, token);
      if (this.closed) throw new OutputFailure('closed');
    };
    const io = this.metadataIO(owner, check, () => {
      carrierUnknown = true;
    });
    owner.start(
      () => this.inventoryWindow(token, operation, (directory) => lease.bind(directory)),
      () => steps.body(io, check),
      () => steps.after(check),
    );
    return { ok: true, operation: this.trackOperation(owner, () => carrierUnknown, access) };
  }
  persist(token: TaskPlanObservation, operation: Operation) {
    return this.persistence.persist(token, operation);
  }

  private inventoryWindow(token: RuntimeAbsent, operation: Operation, bind: (directory: string) => void) {
    try {
      const budget = captureWindow(operation);
      const scope = inventoryScope(this.options, token);
      bind(scope.directory);
      return { deadline: budget.deadline, ...(budget.signal ? { signal: budget.signal } : {}) };
    } catch (error) {
      throw new OutputFailure(
        error instanceof NativeCustodyError && error.reason === 'busy' ? 'busy' : 'invalid_options',
      );
    }
  }
  private metadataIO(
    owner: Pick<OutputIO, 'own' | 'closeHandles'>,
    check: () => void,
    onUnknown: () => void,
  ): OutputIO {
    return {
      check,
      own: (handle) => owner.own(handle),
      closeHandles: (handles) => owner.closeHandles(handles),
      io: async (action) => {
        check();
        let value: Awaited<ReturnType<typeof action>>;
        try {
          value = await action();
        } catch (error) {
          try {
            await this.options.journal.retirements.settleCarrier();
          } catch {
            onUnknown();
          }
          throw error;
        }
        check();
        return value;
      },
    };
  }
  private trackOperation<T extends { readonly ok: true }>(
    owner: OutputLifetime<T>,
    carrierUnknown: () => boolean,
    access: CleanupLease,
  ): OutputLifetime<T>['public'] {
    const result = owner.public;
    const completion = result.quiesced.then(async () => {
      await result.close();
      if (carrierUnknown()) throw new OutputFailure('io');
      this.operations.delete(result);
      access.release();
    });
    this.operations.set(result, completion);
    void completion.catch(() => {});
    return result;
  }
  status() {
    return Object.freeze({
      retained: this.operations.size,
      pendingPlans: this.persistence.status().retained,
      closed: this.closed,
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.resolve().then(async () => {
      const originals = [...this.operations].map(async ([operation, completion]) => {
        const results = await Promise.allSettled([Promise.resolve().then(() => operation.close()), completion]);
        if (results.some((result) => result.status === 'rejected')) throw new OutputFailure('io');
      });
      const results = await Promise.allSettled(originals.concat([this.persistence.close()]));
      if (results.some((result) => result.status === 'rejected') || this.operations.size) throw new OutputFailure('io');
    });
    return this.closing;
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
