import assert from 'node:assert/strict';
import {runArtifactContentPath} from '@beetle/contracts/api';
import type {Run} from '@beetle/contracts/api';
import {readContent, hash} from '../compose/public.js';
import type {automaticClient} from '../compose/public.js';
import {readyContent} from '../compose/content-readiness.js';
import {value} from '../public-api.js';
import {params} from '../../resources/lifecycle/observations.js';
import {record, counter} from '../../resources/values.js';
export async function failureCounters(client: Awaited<ReturnType<typeof automaticClient>>, run: Run, kind: 'assertion' | 'transport') {
 const base = {...params(run), attemptId: run.activeAttemptId};
 const page = value(await client.api.listRunArtifacts({params: base, query: {limit: 100}}));
 assert.equal(page.availability, 'ready'); assert.equal(page.nextCursor, null);
 const matches = page.items.filter(item => item.kind === 'native-summary'); assert.equal(matches.length, 1); const item = matches[0]!;
 assert(item.bytes <= 1048576);
 const path = runArtifactContentPath({...base, artifactId: item.artifactId});
 const bytes = await readContent(await readyContent(signal => client.content(path, {}, signal)), 1048576);
 assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
 const metrics = record(record(JSON.parse(bytes.toString())).metrics);
 const count = (name: string) => counter(record(record(metrics[name]).values).count);
 const counts = {requests: count('beetle_requests'), requiredFailures: count('beetle_required_failures'), transportFailures: count('beetle_transport_failures')};
 assert.deepEqual(counts, {requests: 3, requiredFailures: kind === 'assertion' ? 3 : 0, transportFailures: kind === 'transport' ? 3 : 0});
 return {counts, bytes: item.bytes, sha256: item.sha256};
}
