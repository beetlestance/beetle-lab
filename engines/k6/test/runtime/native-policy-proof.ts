import { chmod, readdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { buildRuntimeScript } from '../../build/index.js';
import { compiled, fixture } from '../suite/fixtures.js';
/** Emit only a synthetic, credential-free script for a networkless k6 inspect probe. */
async function main(): Promise<void> {
  const [directory, extra] = process.argv.slice(2);
  if (!directory || extra || !isAbsolute(directory) || await realpath(directory) !== directory || (await readdir(directory)).length) throw new Error('Expected fresh task-owned directory');
  const config = fixture(); const request = config.requests[0]!;
  config.target = 'http://127.0.0.1:1/'; config.datasets = []; config.secrets = []; delete config.readiness;
  config.requests = [{...request, path: '/probe', query: {}, headers: {}, assertions: []}];
  config.selections = [{...config.selections[0]!, entries: [{...config.selections[0]!.entries[0]!, requestId: request.id}]}];
  const result = await buildRuntimeScript({suite: compiled(config), outputDirectory: directory,
    attempt: {mode: 'standalone', timeoutMs: 1000}, maximumBuildBytes: 1048576});
  await chmod(result.scriptPath, 0o444);
  console.log(JSON.stringify({bytes: result.bytes, peakBytes: result.peakBytes, purpose: 'native-policy-init-only'}));
}
main().catch(() => {console.error('Native policy proof preparation failed'); process.exitCode = 1;});
