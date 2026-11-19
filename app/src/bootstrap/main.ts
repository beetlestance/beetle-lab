import { createStorageFailureExit } from './storage-failure.js';
import { reportFailure } from './failure.js';
import { openApplication } from './api.js';
import { loadBackendConfiguration } from './configuration.js';

// This entrypoint is bundled beside the metadata worker.
process.umask(0o077);
let application: Awaited<ReturnType<typeof openApplication>> | undefined;
let opening: Promise<Awaited<ReturnType<typeof openApplication>>> | undefined;
let stopping = false;
let shutdown: Promise<void> | undefined;
function stop(): Promise<void> {
  stopping = true;
  shutdown ??= Promise.resolve().then(async () => {
    await opening?.catch(() => undefined);
    await application?.close();
  });
  return shutdown;
}
const fatalStorage = createStorageFailureExit(stop);
function storageFailure(error: unknown): void {
  fatalStorage(error);
}
function signal(): void {
  void stop().catch((error) => {
    reportFailure('shutdown_failed', error);
    process.exitCode = 1;
  });
}
process.once('SIGINT', signal);
process.once('SIGTERM', signal);
try {
  const options = await loadBackendConfiguration(process.env, new URL('./worker.js', import.meta.url));
  if (!stopping) {
    opening = openApplication({ ...options.application, onStorageFailure: storageFailure });
    application = await opening;
    if (stopping) await application.close();
    else {
      // Fastify augments its listen options; retain our immutable configuration.
      await application.server.listen({ ...options.listen });
      if (stopping) await application.close();
      else if (options.application.localAccess === 'automatic')
        process.stdout.write('Beetle Lab local access ready. Open the configured URL.\n');
      else process.stdout.write(`Beetle Lab local startup token: ${application.bootstrapToken}\n`);
    }
  }
} catch (error) {
  reportFailure('startup_failed', error);
  await stop().catch((cleanup) => {
    reportFailure('shutdown_failed', cleanup);
  });
  process.stderr.write('Beetle Lab backend startup failed. Check installation configuration and storage.\n');
  process.exitCode = 1;
}
