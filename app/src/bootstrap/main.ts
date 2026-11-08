import { openApplication } from './api.js';
import { loadBackendConfiguration } from './configuration.js';

// This entrypoint is bundled beside worker.js; legacy npm start remains separate.
process.umask(0o077);
let application: Awaited<ReturnType<typeof openApplication>> | undefined;
let stopping = false;
let shutdown: Promise<void> | undefined;
function stop(): Promise<void> {
  stopping = true;
  shutdown ??= Promise.resolve().then(async () => { await application?.close(); });
  return shutdown;
}
function signal(): void {
  void stop().catch(() => { process.exitCode = 1; });
}
process.once('SIGINT', signal);
process.once('SIGTERM', signal);
try {
  const options = await loadBackendConfiguration(process.env, new URL('./worker.js', import.meta.url));
  if (!stopping) {
    application = await openApplication(options.application);
    if (stopping) await application.close();
    else {
      // Fastify augments its listen options; retain our immutable configuration.
      await application.server.listen({ ...options.listen });
      if (stopping) await application.close();
      else process.stdout.write(`Beetle Lab local startup token: ${application.bootstrapToken}\n`);
    }
  }
} catch {
  await stop().catch(() => undefined);
  process.stderr.write('Beetle Lab backend startup failed. Check installation configuration and storage.\n');
  process.exitCode = 1;
}
