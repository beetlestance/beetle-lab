import { capacityFlags, capacityTarget } from './capacity/arguments.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validatePrimitive } from '@beetle/contracts';
import { UnixDockerTransport } from '../../agent/src/backends/docker/index.js';
import { capture, path, requireInput } from './src/capture.js';
import { readRequest } from './src/files.js';
import type { ProvisionRequest } from './types.js';
import { ProvisionError } from './types.js';
import { changeInstalledCapacity } from './capacity/index.js';
import { RecoveryError } from '../recovery/offline.js';
function argumentsFor(argv: readonly string[]): Record<string, string> {
  requireInput(argv.length === 10 || argv.length === 12);
  const result: Record<string, string> = {};
  const names = [
    '--request',
    '--agent-worker',
    '--backend-worker',
    '--operation-id',
    '--docker-socket',
    ...capacityFlags,
  ];
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    const value = argv[index + 1]!;
    requireInput(names.includes(key) && !Object.hasOwn(result, key));
    result[key] = value;
  }
  for (const key of names.slice(0, 4)) requireInput(Object.hasOwn(result, key));
  for (const key of ['--request', '--agent-worker', '--backend-worker']) path(result[key], 4096);
  if (result['--docker-socket']) path(result['--docker-socket'], 4096);
  requireInput(validatePrimitive('uuid', result['--operation-id']).ok);
  const selected = capacityFlags.filter((flag) => Object.hasOwn(result, flag));
  requireInput(selected.length === 1);
  capacityTarget(selected[0], result[selected[0]!]);
  return result;
}
/** Explicit offline adapter. Preserve the operation UUID to resume an interrupted change. */
export async function runCapacityCli(argv: readonly string[]): Promise<number> {
  let args: Record<string, string>;
  try {
    args = argumentsFor([...argv]);
  } catch {
    process.stderr.write('invalid_input\n');
    return 2;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const operation = { signal: controller.signal, deadline: performance.now() + 30000 };
  try {
    const raw = (await readRequest(args['--request']!, operation)) as ProvisionRequest;
    const context = {
      ...operation,
      agentWorkerUrl: pathToFileURL(args['--agent-worker']!),
      backendWorkerUrl: pathToFileURL(args['--backend-worker']!),
      docker: { request: async () => ({ ok: false as const, reason: 'unavailable' as const, dispatched: false }) },
    };
    const admitted = capture(raw, context);
    const flag = capacityFlags.find((value) => Object.hasOwn(args, value))!;
    const result = await changeInstalledCapacity(
      { request: admitted.request, operationId: args['--operation-id']!, increase: capacityTarget(flag, args[flag]) },
      { ...context, docker: new UnixDockerTransport(args['--docker-socket'] ?? admitted.request.dockerSocket) },
    );
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (error) {
    const code = error instanceof ProvisionError || error instanceof RecoveryError ? error.code : 'recovery_required';
    process.stderr.write(code + '\n');
    return 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runCapacityCli(process.argv.slice(2));
