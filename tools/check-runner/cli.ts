import { open } from 'node:fs/promises';
import { runChecks } from './index.js';

async function main(): Promise<void> {
  const [planPath, outputDirectory, extra] = process.argv.slice(2);
  if (!planPath || !outputDirectory || extra) throw new Error('Usage: node --import tsx tools/check-runner/cli.ts PLAN.json NEW_OUTPUT_DIRECTORY');
  const file = await open(planPath, 'r'); let contents: Buffer;
  try {
    contents = Buffer.alloc(65537);
    let length = 0;
    while (length < contents.length) {
      const {bytesRead} = await file.read(contents, length, contents.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65536) throw new Error('Check plan exceeds 64 KiB');
    contents = contents.subarray(0, length);
  } finally { await file.close(); }
  const controller = new AbortController(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const report = await runChecks(JSON.parse(contents.toString('utf8')) as unknown, outputDirectory, controller.signal);
    for (const result of report.results) console.log(`${result.id}: ${result.status}, ${result.elapsedMs}ms, exit ${result.exitCode}`);
    process.exitCode = report.passed ? 0 : 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Check runner failed'); process.exitCode = 1; });
