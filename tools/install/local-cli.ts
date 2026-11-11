import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ProvisionError } from './types.js';
import { parseLocalOptions } from './local/config.js';
import { prepareLocalDeployment } from './local/setup.js';

/** Configuration only, with fixed diagnostics and no daemon or authority capability. */
export async function runLocalSetupCli(argv: readonly string[]): Promise<number> {
  let options;
  try { options = parseLocalOptions([...argv]); }
  catch { process.stderr.write('invalid_input\n'); return 2; }
  const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = await prepareLocalDeployment(options, { signal: controller.signal, deadline: performance.now() + 30000 });
    process.stdout.write(result + '\n'); return 0;
  } catch (cause) {
    process.stderr.write((cause instanceof ProvisionError ? cause.code : 'io') + '\n'); return 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runLocalSetupCli(process.argv.slice(2));
}
