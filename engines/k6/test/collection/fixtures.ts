import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compiled } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { summaryProjection } from '../../runtime/summary.js';
import type { SummaryOptions } from '../../wrapper/collection/index.js';

export async function fixture() {
  const outputDirectory = await mkdtemp('/private/tmp/w09-summary-');
  const config = configFor();
  config.loadPlan.slos = [
    { id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 10 },
    { id: 'errors', metric: 'http_req_failed', stat: 'rate', operator: '<=', value: 0.1 },
  ];
  const suite = compiled(config);
  const raw = summaryProjection(suite, { metrics: {
    http_req_duration: { values: { avg: 3, min: 1, max: 5, count: 2 } },
    beetle_required_failures: { values: { count: 0 }, thresholds: { 'count==0': { ok: true } } },
  } });
  const path = join(outputDirectory, 'beetle-evidence.json');
  await writeFile(path, raw, { mode: 0o600 });
  const options: SummaryOptions = { outputDirectory, uid: process.getuid!(), compiledSuite: suite,
    process: { spawned: true, exitCode: 0, signal: null, cause: null, metricBytes: 0,
      diagnosticBytes: 0, collection: 'partial', state: 'stopped', stdioClosed: true, groupAbsent: true, quiescent: true },
    deadlineMs: Date.now() + 10_000, timeoutMs: 1000 };
  return { options, path, raw, json: JSON.parse(raw) as { version: number; metrics: Record<string, { values: Record<string, unknown>; thresholds: { expression: string; ok: unknown }[] }> },
    dispose: () => rm(outputDirectory, { recursive: true, force: true }) };
}
