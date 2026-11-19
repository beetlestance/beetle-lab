import { drain } from './runtime-close.js';
import { NoTaskReceipt } from '../no-task-receipt/index.js';
import { StorageSettlement } from '../storage-settlement/index.js';
import { RetirementPipeline } from '../retirement-pipeline/index.js';
import { NativeReceipt } from '../native-receipt/index.js';
import { NativeRemoval } from '../native-removal/index.js';
import { TaskInventory } from '../task-inventory/index.js';
import { RuntimeRetirement } from '../runtime-retirement/index.js';
import { ProducerRetirement } from '../producer-retirement/index.js';
import { DockerBackend, type DockerTransport } from '../backends/docker/index.js';
import type { ProducerGate } from '../producer-gate/index.js';
import type { Journal } from '../journal/index.js';
import type { VerifiedRoot } from '../staging/index.js';
import type { Catalog } from '../catalog/index.js';
import type { InstallationController } from '../installation/index.js';

export interface RetirementServiceOptions {
  readonly journal: Journal;
  readonly gate: ProducerGate;
  readonly root: VerifiedRoot;
  readonly catalog: Catalog;
  readonly transport: DockerTransport;
  readonly installation: Pick<InstallationController, 'retireOutput'>;
}

/**
 * The one retirement chain shared by the serving runtime and the offline reconcile command:
 * producer then runtime retirement, task inventory, native removal and receipts, settlement.
 */
export class RetirementServices {
  readonly retirement: ProducerRetirement;
  readonly retiredRuntime: RuntimeRetirement;
  readonly taskInventory: TaskInventory;
  readonly nativeRemoval: NativeRemoval;
  readonly nativeReceipt: NativeReceipt;
  readonly noTaskReceipt: NoTaskReceipt;
  readonly cleanup: RetirementPipeline;
  readonly settlement: StorageSettlement;
  private readonly gate: ProducerGate;
  constructor(options: RetirementServiceOptions) {
    const { journal, gate, root, transport } = options;
    this.gate = gate;
    this.retirement = new ProducerRetirement({
      journal: journal.retirements,
      funding: journal.retirements,
      gate,
      installation: options.installation,
    });
    this.retiredRuntime = new RuntimeRetirement({
      journal,
      root,
      catalog: options.catalog,
      transport,
      backend: () => new DockerBackend(transport),
    });
    this.taskInventory = new TaskInventory({ journal, root });
    this.nativeRemoval = new NativeRemoval({ journal, root });
    this.nativeReceipt = new NativeReceipt({ journal, root, removal: this.nativeRemoval });
    this.noTaskReceipt = new NoTaskReceipt({ journal, root, transport });
    this.cleanup = new RetirementPipeline({
      journal,
      producer: this.retirement,
      runtime: this.retiredRuntime,
      inventory: this.taskInventory,
      removal: this.nativeRemoval,
      receipt: this.nativeReceipt,
      noTask: this.noTaskReceipt,
    });
    this.settlement = new StorageSettlement({ journal });
  }
  /** Stops background settlement and no-task work before the ordered close. */
  stop(): void {
    this.settlement.stop();
    this.noTaskReceipt.stop();
  }
  /** Closes dependants before what they use, the producer gate last; reports whether all closed. */
  async close(): Promise<boolean> {
    let closed = true;
    for (const service of [
      this.settlement,
      this.cleanup,
      this.noTaskReceipt,
      this.nativeReceipt,
      this.nativeRemoval,
      this.taskInventory,
      this.retiredRuntime,
      this.retirement,
      this.gate,
    ])
      closed = (await drain([() => service.close()])) && closed;
    return closed;
  }
}
