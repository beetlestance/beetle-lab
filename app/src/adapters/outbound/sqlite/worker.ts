import { localSessionOperation, captureLocalSessionReply } from './local-session/index.js';
import { deletionOperation, captureDeletionReply } from './output-deletion/index.js';
import { executionOperation, captureExecutionReply } from './execution-binding/index.js';
import { absenceOperation, captureAbsenceReply } from './output-absence/index.js';
import { finalizationOperation, captureFinalizationReply } from './output-finalization/index.js';
import { resultOperation, captureResultReply } from './run-results/index.js';
import { outputOperation, captureOutputReply } from './output-custody/index.js';
import { eventOperation, captureEventReply } from './event-custody/index.js';
import { parentPort, workerData } from 'node:worker_threads';
import { checkedBootstrap, checkedOperation, boundedCopy, operationReplyLimit } from './input.js';
import { dispatchOperation, captureDispatchReply } from './dispatch-wire.js';
import { initialize } from './schema.js';
import { Store, safeCode } from './store.js';
import type { Bootstrap, Command, Reply, Operation, Value } from './protocol.js';

const port = parentPort;
if (!port) throw new Error('Storage worker required');
function commandId(message: unknown): unknown {
  const descriptor = message !== null && typeof message === 'object' ? Object.getOwnPropertyDescriptor(message, 'messageId') : undefined;
  const messageId: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  return messageId;
}
function captureReply(operation: Operation, original: Value): Value {
  if (localSessionOperation(operation)) return captureLocalSessionReply(operation, original);
  if (deletionOperation(operation)) return captureDeletionReply(operation, original);
  if (executionOperation(operation)) return captureExecutionReply(operation.key, original);
  return absenceOperation(operation) ? captureAbsenceReply(operation, original) : finalizationOperation(operation) ? captureFinalizationReply(operation, original) : resultOperation(operation) ? captureResultReply(operation.key, original) : outputOperation(operation) ? captureOutputReply(operation, original) : eventOperation(operation) ? captureEventReply(operation, original)
        : dispatchOperation(operation) ? captureDispatchReply(operation, original)
        : boundedCopy(original, operationReplyLimit(operation));
}
function start(): void {
  let store: Store;
  let runtimeTtlMs: number;
  try {
    const data = workerData as { path: string; bootstrap: Bootstrap };
    const bootstrap = checkedBootstrap(data.bootstrap);
    runtimeTtlMs = bootstrap.runtimeTtlMs ?? 5000;
    const db = initialize(data.path);
    try { store = new Store(db, bootstrap); } catch (error) { db.close(); throw error; }
  } catch (error) {
    port?.postMessage({ kind: 'startup_error', code: safeCode(error) } satisfies Reply);
    port?.close(); return;
  }
  port?.on('message', (message: unknown) => {
    const messageId = commandId(message);
    if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) {
      port.postMessage({ kind: 'startup_error', code: 'unavailable' } satisfies Reply); return;
    }
    try {
      const operation = checkedOperation(message as Command, runtimeTtlMs);
      const original = store.execute(operation);
      const value = captureReply(operation, original);
      port.postMessage({ kind: 'result', messageId, ok: true, value } satisfies Reply);
      if (operation.kind === 'close') port.close();
    } catch (error) {
      port.postMessage({ kind: 'result', messageId, ok: false, code: safeCode(error) } satisfies Reply);
    }
  });
  port?.postMessage({ kind: 'ready' } satisfies Reply);
}
start();
