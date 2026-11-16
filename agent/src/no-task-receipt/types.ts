import type { Journal } from '../journal/index.js';
import type { VerifiedRoot } from '../staging/index.js';
import type { DockerTransport } from '../backends/docker/index.js';
import type { InventoryPorts } from '../task-inventory/index.js';
import type { OutputPorts,OutputCollectionReason } from '../collection/output/index.js';
import type { StoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
export interface NoTaskReceiptOptions {readonly journal:Journal;readonly root:VerifiedRoot;readonly transport:DockerTransport}
export interface NoTaskNativePorts {readonly filesystem:InventoryPorts;readonly timing:OutputPorts}
export interface NoTaskWork {
 readonly result:Promise<{readonly ok:true;readonly stored:StoredNoTaskReceipt}|{readonly ok:false;readonly reason:OutputCollectionReason}>;
 readonly quiesced:Promise<void>;close():Promise<void>;
}
