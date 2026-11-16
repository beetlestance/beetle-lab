import { nodeFetch } from './http.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeJson } from '@beetle/contracts';
import { authenticatedClient, establishCredentials } from './auth.js';
import { execute } from './execute.js';
import { ClientError } from './errors.js';
import { parseOptions } from './options.js';
import { waitClock } from './wait.js';
export type { ClientOutput, ClientStreams } from './output.js';
import { streamOutput } from './output.js';
import type { ClientStreams } from './output.js';
/** Explicit one-command process; diagnostic records contain no source errors or secrets. */
export async function runClient(argv: readonly string[], streams: ClientStreams, fetcher = nodeFetch): Promise<number> {
  let controller: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller?.abort();
  try {
    const options = parseOptions(argv); controller = new AbortController();
    const duration = options.waitMs ?? 30000; const deadline = waitClock.now() + duration;
    timer = setTimeout(abort, duration); timer.unref(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
    const session = sessionReceipt(options.command);
    if (session) {
      await establishCredentials(options, controller.signal, fetcher); await streams.stdout.write(JSON.stringify(session) + '\n', AbortSignal.timeout(1000)); return 0;
    }
    const api = await authenticatedClient(options, fetcher);
    const result = await execute({options, api, signal: controller.signal, deadline, clock: waitClock});
    await streams.stdout.write(encodeJson(result.value, 1048575) + '\n', AbortSignal.timeout(1000)); return result.exit;
  } catch (cause) {
    const error = cause instanceof ClientError ? cause : new ClientError('io', 3);
    try {await streams.stderr.write(JSON.stringify({error: error.code, ...(error.requestId ? {requestId: error.requestId} : {})}) + '\n', AbortSignal.timeout(1000));} catch {return 3;}
    return error.exit;
  } finally {if (timer) clearTimeout(timer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runClient(process.argv.slice(2), {stdout: streamOutput(process.stdout), stderr: streamOutput(process.stderr)});
}

function sessionReceipt(command: string): object | undefined {
  if (command === 'pair') return {paired: true};
  if (command === 'connect') return {connected: true};
  return undefined;
}
