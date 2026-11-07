import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { options } from './fixtures.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
export async function ownedFiles(source = 'process.stdout.write("metric");'): Promise<ReturnType<typeof options>> {
  const directory = await realpath(await mkdtemp('/private/tmp/w09-process-'));
  directories.push(directory);
  const script = join(directory, 'suite.js'); const emptyConfig = join(directory, 'empty.json');
  await writeFile(script, source, { mode: 0o600 }); await writeFile(emptyConfig, '{}\n', { mode: 0o600 });
  return options({ directory, script, emptyConfig, binary: await realpath(process.execPath) });
}
