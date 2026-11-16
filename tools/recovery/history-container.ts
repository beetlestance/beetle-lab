import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { captureRequest } from './src/request.js';
import { RecoveryError } from './src/types.js';
import { serveHistory } from './run.js';
/** Separate read-only viewer process. No socket, installer or serving identity. */
export async function runHistoricalContainer(environment: Readonly<Record<string, string | undefined>>): Promise<number> {
  process.umask(0o077); const controller = new AbortController(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const request = captureRequest({version: 1, command: 'serve', root: environment.BEETLE_HISTORY_ROOT,
      externalOrigin: environment.BEETLE_HISTORY_EXTERNAL_ORIGIN ?? 'http://127.0.0.1:4568', host: '0.0.0.0', port: 4311,
      limits: {maximumBytes: Number(environment.BEETLE_HISTORY_MAXIMUM_BYTES ?? '1073741824'),
        maximumEntries: Number(environment.BEETLE_HISTORY_MAXIMUM_ENTRIES ?? '10000')},
      timeoutMs: Number(environment.BEETLE_HISTORY_TIMEOUT_MS ?? '600000')});
    if (request.command !== 'serve') throw new RecoveryError('invalid_input');
    await serveHistory(request, new URL('./backend-worker.js', import.meta.url), {signal: controller.signal, deadline: performance.now() + request.timeoutMs}); return 0;
  } catch (error) {process.stderr.write((error instanceof RecoveryError ? error.code : 'unavailable') + '\n'); return 1;}
  finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runHistoricalContainer(process.env);
