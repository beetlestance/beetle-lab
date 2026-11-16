import assert from 'node:assert/strict';
import {record} from '../../resources/values.js';
import {array, bounded, count} from '../conformance/values.js';
import {summarizeRss} from './observe.js';
const roles = ['frontend', 'backend', 'agent']; const phases = ['idle', 'loaded', 'post-idle'];
export function publicRssFacts(input: unknown) {
 const source = record(input); assert(Array.isArray(source.rssPoints) && source.rssPoints.length <= 128);
 let previous = -1;
 const points = source.rssPoints.map(value => {
  const row = record(value); assert(typeof row.phase === 'string' && phases.includes(row.phase));
  const at = bounded(row.at, 120000); assert(at > previous); previous = at; const seen = new Set<string>();
  const peers = array(row.peers, 3).map(value => {
   const peer = record(value); assert(typeof peer.role === 'string' && roles.includes(peer.role) && !seen.has(peer.role)); seen.add(peer.role);
   const processes = count(peer.processes, 128); assert(processes > 0);
   const summedRssBytes = count(peer.summedRssBytes, 268435456); const largestProcessRssBytes = count(peer.largestProcessRssBytes, summedRssBytes);
   assert(largestProcessRssBytes > 0); return {role: peer.role, processes, summedRssBytes, largestProcessRssBytes};
  });
  return {phase: row.phase, at, peers};
 });
 const peers = roles.map(role => ({role, id: '', memory: role === 'frontend' ? 67108864 : 268435456}));
 const result = summarizeRss(points, peers); assert.deepEqual(source.processRss, result); return result;
}
