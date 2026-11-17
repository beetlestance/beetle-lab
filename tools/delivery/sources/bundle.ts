import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveProducer } from '../producer.js';
import { deliveryDigest } from '../files.js';
import { sourceBudget } from './fetch.js';
import type { sourceInputs } from './inputs.js';
export async function bundleSources(
  inputs: Awaited<ReturnType<typeof sourceInputs>>,
  payload: string,
  output: string,
  downloadedBytes: number,
): Promise<void> {
  const archive = join(output, 'sources.tar.gz');
  const maximum = sourceBudget + 128 * 1024 ** 2;
  await archiveProducer({
    executable: 'python3',
    args: [fileURLToPath(new URL('./pack.py', import.meta.url)), payload],
    destination: archive,
    maximumBytes: maximum,
  });
  const digest = await deliveryDigest(archive, maximum);
  await writeFile(
    join(output, 'source-bundle.json'),
    JSON.stringify(
      {
        format: 'beetle-source-bundle',
        version: 1,
        revision: inputs.revision,
        candidates: inputs.candidates.map((row) => ({ architecture: row.architecture, configs: row.configs })),
        archive: { name: 'sources.tar.gz', ...digest },
        downloadedBytes,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      revision: inputs.revision,
      sources: inputs.npm.length + inputs.catalog.alpine.length + 3,
      archiveBytes: digest.bytes,
    }),
  );
}
