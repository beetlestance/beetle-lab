import {expect, it} from 'vitest';
import {captureRss} from './capture.js';
import {summarizeRss} from './observe.js';
it('converts ps KiB and reports summed/largest process RSS without retaining PIDs', () => {
 expect(captureRss(' PID RSS\n 10 100\n 11 200\n')).toEqual({processes: 2, summedRssBytes: 307200, largestProcessRssBytes: 204800});
});
it('rejects malformed, duplicate, unbounded or unobserved process facts', () => {
 for (const value of ['PID RSS\n1 0', 'PID RSS\n1 2\n1 3', 'PID COMMAND\n1 2', 'PID RSS\n1 -2', 'x'.repeat(65537)]) expect(() => captureRss(value)).toThrow();
});
it('requires every phase/peer to have observed samples below its declared ceiling', () => {
 const peers = ['frontend', 'backend', 'agent'].map(role => ({role, id: 'a'.repeat(64), memory: 1048576}));
 const points = ['idle', 'loaded', 'post-idle'].flatMap(phase => [0, 1].map(at => ({phase, at, peers: peers.map(peer => ({role: peer.role, processes: 1, summedRssBytes: 2048, largestProcessRssBytes: 2048}))})));
 expect(summarizeRss(points, peers)).toHaveLength(9); expect(() => summarizeRss(points.slice(1), peers)).toThrow();
 points[0]!.peers[0]!.summedRssBytes = 2097152; expect(() => summarizeRss(points, peers)).toThrow();
});
