import assert from 'node:assert/strict';
import {record} from '../../resources/values.js';
import {images} from './values.js';
import {shortFacts} from './short.js';
import {longFacts} from './long.js';
const phases: Record<string, string> = {'engine-executors': 'discovery-reached', 'engine-thresholds': 'slo', 'engine-failures': 'transport',
 'requests-data': 'malformed-response', 'parallel-shared': 'settlement', 'parallel-isolated': 'settlement', 'long-stream': 'post-idle'};
export function publicCase(input: unknown, id: string, revision: string) {
 assert(/^[a-f0-9]{40}$/.test(revision) && Object.hasOwn(phases, id)); const row = record(input);
 assert.equal(row.sourceRevision ?? row.revision, revision); assert.equal(row.architecture, 'amd64');
 assert(typeof row.harnessNode === 'string' && /^v24\.[0-9]+\.[0-9]+$/.test(row.harnessNode));
 assert.equal(row.status, 'passed'); assert.equal(row.phase, phases[id]); assert.equal(row.cleanupVerified, true);
 const facts = id === 'long-stream' ? longFacts(row.results) : shortFacts(id, row.results);
 return {id, status: 'passed', phase: phases[id]!, cleanupVerified: true, harnessNode: row.harnessNode, imageIds: images(row.imageIds), facts};
}
