import assert from 'node:assert/strict';
import {runArtifactContentPath} from '@beetle/contracts/api';
import type {Run} from '@beetle/contracts/api';
import type {automaticClient} from '../compose/public.js';
import {readContent, hash} from '../compose/public.js';
import {readyContent} from '../compose/content-readiness.js';
import {value} from '../public-api.js';
import {params} from '../../resources/lifecycle/observations.js';
export function noCanary(bytes: string | Uint8Array, canaries: readonly string[]) {
 const buffer = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
 for (const secret of canaries) assert(!buffer.includes(Buffer.from(secret)), 'Private canary escaped into observable output');
}
export async function audit(client: Awaited<ReturnType<typeof automaticClient>>, run: Run, canaries: readonly string[]) {
 const base = {...params(run), attemptId: run.activeAttemptId};
 const listed = value(await client.api.listRunArtifacts({params: base, query: {limit: 100}}));
 assert.equal(listed.availability, 'ready'); assert.equal(listed.nextCursor, null); assert.equal(listed.items.length, 8);
 noCanary(JSON.stringify(listed), canaries); const artifacts = [];
 for (const item of listed.items) {
  const bytes = await readContent(await readyContent(signal => client.content(runArtifactContentPath({...base, artifactId: item.artifactId}), {}, signal)), 16777216, 4096);
  assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256); noCanary(bytes, canaries);
  artifacts.push({kind: item.kind, bytes: item.bytes, sha256: item.sha256});
 }
 return {artifacts, canariesAbsent: true};
}
