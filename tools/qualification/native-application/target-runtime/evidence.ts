import assert from 'node:assert/strict';
import {runArtifactContentPath} from '@beetle/contracts/api';
import type {Run} from '@beetle/contracts/api';
import {decodeTargetRuntimeReport, targetMetricNames} from '@beetle/contracts/target-runtime';
import type {TargetRuntimeReport} from '@beetle/contracts/target-runtime';
import type {automaticClient} from '../compose/public.js';
import {readContent, hash} from '../compose/public.js';
import {readyContent} from '../compose/content-readiness.js';
import {params} from '../../resources/lifecycle/observations.js';
import {value} from '../public-api.js';
export function qualifyReport(report: TargetRuntimeReport) {
 assert.equal(report.scope, 'target-reported'); assert.equal(report.limited, false); assert.equal(report.missed, 2);
 const expected = Object.fromEntries(targetMetricNames.map(name => [name, null as number | null]));
 Object.assign(expected, {heapAlloc: 0, rss: 123456, 'cppHeap.allocated_size': 42, 'cppHeap.used_size': 0,
 'eventLoopDelay.mean': 0, 'eventLoopDelay.p90': 2, 'eventLoopDelay.p99': 3, 'eventLoopDelay.max': 4, 'gc.count': 7, 'gc.duration': 12.5});
 const phases = ['before', 'during', 'after'] as const;
 const phaseCounts = phases.map(phase => {const rows = report.samples.filter(sample => sample.phase === phase); assert(rows.some(sample => sample.status === 'ready')); return {phase, samples: rows.length};});
 const unavailable = report.samples.filter(sample => sample.status === 'unavailable'); assert.equal(unavailable.length, 2);
 assert.deepEqual(unavailable.map(sample => sample.reason).sort(), ['http', 'invalid_json']);
 for (const sample of report.samples) {
  if (sample.status === 'ready') assert.deepEqual(sample.values, expected);
  else assert(Object.values(sample.values).every(value => value === null));
 }
 assert(!JSON.stringify(report).includes('TARGET_PRIVATE_MARKER'));
 assert(report.samples.every((sample, index) => index === 0 || Date.parse(sample.observedAt) >= Date.parse(report.samples[index - 1]!.observedAt)));
 return {scope: 'target-reported', phaseCounts, samples: report.samples.length, missed: 2, limited: false, readyValues: expected,
 unavailableReasons: ['http', 'invalid_json'], privateFieldsAbsent: true};
}
export async function evidence(client: Awaited<ReturnType<typeof automaticClient>>, run: Run, capture: (value: {bytes: number; sha256: string; report: TargetRuntimeReport}) => void) {
 const base = {...params(run), attemptId: run.activeAttemptId};
 const page = value(await client.api.listRunArtifacts({params: base, query: {limit: 100}})); assert.equal(page.availability, 'ready'); assert.equal(page.nextCursor, null);
 const matches = page.items.filter(row => row.kind === 'target-runtime'); assert.equal(matches.length, 1); const item = matches[0]!; assert(item.bytes <= 1048576);
 const bytes = await readContent(await readyContent(signal => client.content(runArtifactContentPath({...base, artifactId: item.artifactId}), {}, signal)), 1048576);
 assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
 const report = decodeTargetRuntimeReport(bytes); capture({bytes: item.bytes, sha256: item.sha256, report});
 return {bytes: item.bytes, sha256: item.sha256, ...qualifyReport(report)};
}
