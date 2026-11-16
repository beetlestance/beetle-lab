import { constants } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { coldBackup } from './src/backup.js';
import { sourceLayout } from './src/layout.js';
import { restoreHistory } from './src/restore.js';
import { openHistoryViewer } from './src/viewer/index.js';
import { RecoveryIO } from './src/io.js';
import { regular } from './src/files.js';
import { captureRequest } from './src/request.js';
import type { RecoveryRequest } from './src/request.js';
import { RecoveryError } from './src/types.js';
import type { RecoveryOperation } from './src/types.js';
function argumentsFor(argv: readonly string[]) {
  if (argv.length !== 2 || argv[0] !== '--request') throw new RecoveryError('invalid_input');
  const path = argv[1]!;
  if (!isAbsolute(path) || normalize(path) !== path || path.length > 4096) throw new RecoveryError('invalid_input'); return path;
}
async function request(path: string, operation: RecoveryOperation): Promise<RecoveryRequest> {
  const io = new RecoveryIO(operation);
  try {
    const file = await io.acquireFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await io.issue(() => file.value.stat({bigint: true})); regular(info, 8192, false);
    const bytes = new Uint8Array(Number(info.size)); const part = await io.issue(() => file.value.read(bytes, 0, bytes.length, 0));
    if (part.bytesRead !== bytes.length) throw new RecoveryError('integrity');
    return captureRequest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
  } finally {await io.closeAll();}
}
export async function runRecoveryCli(argv: readonly string[], workers = {agentWorkerUrl: new URL('./agent-worker.js', import.meta.url), metadataWorkerUrl: new URL('./backend-worker.js', import.meta.url)}): Promise<number> {
  process.umask(0o077); const controller = new AbortController(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const captured = await request(argumentsFor(argv), {signal: controller.signal, deadline: performance.now() + 10000});
    const operation = {signal: controller.signal, deadline: performance.now() + captured.timeoutMs};
    if (captured.command === 'serve') await serveHistory(captured, workers.metadataWorkerUrl, operation);
    else {
      const result = captured.command === 'backup'
        ? await coldBackup({layout: sourceLayout(captured.source), destination: captured.destination, limits: captured.limits, operation}, workers)
        : await restoreHistory({...captured, operation});
      process.stdout.write(JSON.stringify(result) + '\n');
    }
    return 0;
  } catch (error) {process.stderr.write((error instanceof RecoveryError ? error.code : 'unavailable') + '\n'); return 1;}
  finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);}
}
export async function serveHistory(request: Extract<RecoveryRequest, {command: 'serve'}>, metadataWorkerUrl: URL, operation: RecoveryOperation): Promise<void> {
  const app = await openHistoryViewer({...request, metadataWorkerUrl, operation});
  try {
    await app.server.listen({host: request.host, port: request.port}); process.stdout.write('{"status":"historical","readOnly":true}\n');
    if (!operation.signal.aborted) await new Promise<void>(resolve => {operation.signal.addEventListener('abort', () => resolve(), {once: true});});
  } finally {await app.close();}
}
