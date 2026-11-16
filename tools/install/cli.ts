import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { UnixDockerTransport } from '../../agent/src/backends/docker/index.js';
import { provisionFreshInstallation, ProvisionError } from './index.js';
import type { ProvisionRequest } from './types.js';
import { capture, path } from './src/capture.js';
import { readRequest } from './src/files.js';

function argumentsFor(argv: readonly string[]): Record<string, string> {
  if (argv.length !== 6) throw new Error('arguments');
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!; const value = argv[index + 1]!;
    if (!['--request', '--agent-worker', '--backend-worker'].includes(key) || Object.hasOwn(result, key)) throw new Error('arguments');
    path(value, 4096); result[key] = value;
  }
  return result;
}
/** Narrow executable adapter; fixed output never includes raw errors or request data. */
export async function runCli(argv: readonly string[]): Promise<number> {
  let args: Record<string, string>;
  try { args = argumentsFor([...argv]); }
  catch { process.stderr.write('invalid_input\n'); return 2; }
  const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const deadline = performance.now() + 30_000;
  try {
    const raw = await readRequest(args['--request']!, { signal: controller.signal, deadline }) as ProvisionRequest;
    // Capture/validate before constructing the socket capability; never read process.env.
    const context = { signal: controller.signal, deadline, agentWorkerUrl: pathToFileURL(args['--agent-worker']!),
      backendWorkerUrl: pathToFileURL(args['--backend-worker']!), docker: { request: async () => ({ ok: false as const, reason: 'unavailable' as const, dispatched: false }) } };
    const admitted = capture(raw, context);
    const result = await provisionFreshInstallation(admitted.request, { ...context, docker: new UnixDockerTransport(admitted.request.dockerSocket) });
    process.stdout.write(JSON.stringify(result) + '\n'); return 0;
  } catch (error) {
    process.stderr.write((error instanceof ProvisionError ? error.code : 'invalid_input') + '\n'); return 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && isAbsolute(resolve(process.argv[1])) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
