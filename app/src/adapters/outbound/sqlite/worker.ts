import { parentPort, workerData } from 'node:worker_threads';
import { checkedBootstrap, checkedOperation, boundedCopy, operationReplyLimit } from './input.js';
import { dispatchOperation, captureDispatchReply } from './dispatch-wire.js';
import { initialize } from './schema.js';
import { Store, safeCode } from './store.js';
import type { Bootstrap, Command, Reply } from './protocol.js';

const port = parentPort;
if (!port) throw new Error('Storage worker required');
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
  port?.on('message', (message: Command) => {
    try {
      const operation = checkedOperation(message, runtimeTtlMs);
      const original = store.execute(operation);
      const value = dispatchOperation(operation) ? captureDispatchReply(operation, original)
        : boundedCopy(original, operationReplyLimit(operation));
      port.postMessage({ kind: 'result', messageId: message.messageId, ok: true, value } satisfies Reply);
      if (operation.kind === 'close') port.close();
    } catch (error) {
      port.postMessage({ kind: 'result', messageId: message.messageId, ok: false, code: safeCode(error) } satisfies Reply);
    }
  });
  port?.postMessage({ kind: 'ready' } satisfies Reply);
}
start();
