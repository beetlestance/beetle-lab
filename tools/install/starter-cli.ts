import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createStarterRequest } from './starter.js';
import type { StarterOptions } from './starter.js';
import { ProvisionError } from './types.js';
import { canonical, check, path } from './src/capture.js';
import { readRequest } from './src/files.js';

function optionsPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--options') throw new ProvisionError('invalid_input');
  path(argv[1], 4096); return argv[1];
}
/** Fixed diagnostics only; never opens an output file or invokes provisioning. */
export async function runStarterCli(argv: readonly string[]): Promise<number> {
  let file: string;
  try { file = optionsPath([...argv]); }
  catch { process.stderr.write('invalid_input\n'); return 2; }
  const controller = new AbortController(); const abort = () => controller.abort();
  const operation = { signal: controller.signal, deadline: performance.now() + 30_000 };
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const options = await readRequest(file, operation) as StarterOptions;
    check(operation);
    const json = canonical(createStarterRequest(options));
    check(operation);
    process.stdout.write(json + '\n'); return 0;
  } catch (error) {
    process.stderr.write((error instanceof ProvisionError ? error.code : 'invalid_input') + '\n'); return 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runStarterCli(process.argv.slice(2));
}
