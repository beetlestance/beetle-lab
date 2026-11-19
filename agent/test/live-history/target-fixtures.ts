import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureTargetRuntimeReport, targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import type { historyFixture } from './fixtures.js';
import { sha } from './fixtures.js';

type Fixture = Awaited<ReturnType<typeof historyFixture>>;
export async function targetFixture(f: Fixture, count = 3) {
  const samples: TargetRuntimeSample[] = Array.from({ length: count }, (_, index) => {
    const unavailable = index === 1;
    const values = Object.fromEntries(targetMetricNames.map(name => [name, unavailable ? null : index + 1]));
    return captureTargetRuntimeReport({ format: 'beetle-target-runtime', version: 1, scope: 'target-reported',
      samples: [{ observedAt: new Date(index * 1000).toISOString(), phase: index === 0 ? 'before' : index === count - 1 ? 'after' : 'during',
        status: unavailable ? 'unavailable' : 'ready', reason: unavailable ? 'http' : null, values,
        ...(!unavailable ? { gcWindow: { generation: 1, through: index + 1, recentMs: Array(Math.min(16, index + 1)).fill(3) } } : {}) }],
      missed: Number(unavailable), limited: false }).samples[0]!;
  });
  const prefix = { scope: f.options.scope, samples: count, intervalMs: 1000,
    data: { artifactId: '00000000-0000-4000-8000-000000000007', relativePath: 'target-samples.ndjson' as const, bytes: 1, sha256: '' } };
  const header = { format: 'beetle-target-samples', version: 1, scope: f.options.scope, artifactId: prefix.data.artifactId, intervalMs: 1000 };
  const records = [header, ...samples.map((sample, index) => ({ kind: 'sample', sequence: index + 1, sample }))];
  const path = join(f.directory, prefix.data.relativePath);
  const save = async (text = records.map(row => JSON.stringify(row)).join('\n') + '\n') => {
    await writeFile(path, text, { mode: 0o600 }); prefix.data.bytes = Buffer.byteLength(text); prefix.data.sha256 = sha(text); return text;
  };
  const text = await save(); f.prefix.target = prefix;
  f.options.frame.publishedAtMs = f.options.frame.capturedAtMs = Math.max(f.options.frame.publishedAtMs, count * 1000);
  return { samples, prefix, header, records, path, text, save };
}
