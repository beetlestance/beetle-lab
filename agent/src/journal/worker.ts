import { parentPort, workerData } from 'node:worker_threads';
import type { Command, ErrorCode, Reply } from './protocol.js';
import { initialize } from './schema.js';
import { Failure } from './sql.js';
import { Store } from './store.js';

const port = parentPort;
if (!port) throw new Error('Journal worker required');
function startupCode(error: unknown): ErrorCode {
  if (error instanceof Failure) return error.code;
  if (typeof error === 'object' && error !== null && 'errcode' in error &&
    (error.errcode === 5 || error.errcode === 6)) return 'owned';
  return 'unavailable';
}
function start(): void {
  let store: Store;
  try {
    const data = workerData as { path: string; spoolQuotaBytes: number };
    store = new Store(initialize(data.path), data.spoolQuotaBytes);
  } catch (error) { port?.postMessage({ kind: 'startup_error', code: startupCode(error) } satisfies Reply); port?.close(); return; }
  port?.on('message', (command: Command) => {
    try {
      const value = store.execute(command);
      port.postMessage({ kind: 'result', id: command.id, ok: true, value } satisfies Reply);
      if (command.kind === 'close') port.close();
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'unavailable';
      const recovery = error instanceof Failure ? error.recovery : undefined;
      port.postMessage({ kind: 'result', id: command.id, ok: false, code,
        ...(recovery ? { recovery } : {}) } satisfies Reply);
    }
  });
  port?.postMessage({ kind: 'ready' } satisfies Reply);
}
start();
