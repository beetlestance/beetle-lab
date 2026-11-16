import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import type {Peer} from '../load/observe.js';
import {captureRss} from './capture.js';
const execute = promisify(execFile); const phases = ['idle', 'loaded', 'post-idle'];
interface Point {readonly phase: string; readonly at: number; readonly peers: readonly {role: string; processes: number; summedRssBytes: number; largestProcessRssBytes: number}[]}
async function sample(context: string, peer: Peer) {
 const env: NodeJS.ProcessEnv = {...process.env, DOCKER_API_VERSION: '1.47'}; delete env.DOCKER_HOST; delete env.DOCKER_CONTEXT;
 const reply = await execute('docker', ['--context', context, 'top', peer.id, '-eo', 'pid,rss'], {env, timeout: 10000, maxBuffer: 65536, encoding: 'utf8'});
 return {role: peer.role, ...captureRss(reply.stdout)};
}
export function observeRss(context: string, peers: readonly Peer[], phase: () => string) {
 assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context) && peers.length === 3);
 assert(peers.every(peer => /^[a-f0-9]{64}$/.test(peer.id))); const stop = new AbortController(); const points: Point[] = [];
 let failure: unknown; const started = performance.now();
 const work = (async () => {
  while (!stop.signal.aborted) {
   assert(performance.now() - started < 120000 && points.length < 128); const before = phase();
   if (phases.includes(before)) {
    const outcomes = await Promise.allSettled(peers.map(peer => sample(context, peer)));
    const rows = outcomes.map(row => {if (row.status === 'rejected') throw row.reason; return row.value;});
    if (phase() === before) points.push({phase: before, at: performance.now() - started, peers: rows});
   }
   await delay(1000, undefined, {signal: stop.signal}).catch(error => {if (!stop.signal.aborted) throw error;});
  }
 })().catch(error => {failure = error;});
 return {async close() {stop.abort(); await work; if (failure !== undefined) throw failure; return points;}};
}
export function summarizeRss(points: readonly Point[], peers: readonly Peer[]) {
 return phases.flatMap(phase => peers.map(peer => {
  const rows = points.filter(point => point.phase === phase).map(point => {const matches = point.peers.filter(row => row.role === peer.role); assert.equal(matches.length, 1); return matches[0]!;});
  assert(rows.length >= 2); const peakSummedRssBytes = Math.max(...rows.map(row => row.summedRssBytes)); assert(peakSummedRssBytes <= peer.memory);
  return {phase, role: peer.role, samples: rows.length, peakSummedRssBytes, peakLargestProcessRssBytes: Math.max(...rows.map(row => row.largestProcessRssBytes)),
   peakProcesses: Math.max(...rows.map(row => row.processes)), ceilingBytes: peer.memory};
 }));
}
