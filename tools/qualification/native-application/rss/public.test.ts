import {expect, it} from 'vitest';
import {publicRssFacts} from './public.js';
const roles = ['frontend', 'backend', 'agent'];
function fixture() {
 const rssPoints = ['idle', 'loaded', 'post-idle'].flatMap((phase, index) => [1, 2].map(offset => ({phase, at: index * 3 + offset,
 peers: roles.map(role => ({role, processes: 1, summedRssBytes: 2048, largestProcessRssBytes: 2048, pid: 'PRIVATE_CANARY'})), private: 'PRIVATE_CANARY'})));
 const processRss = ['idle', 'loaded', 'post-idle'].flatMap(phase => roles.map(role => ({phase, role, samples: 2, peakSummedRssBytes: 2048,
 peakLargestProcessRssBytes: 2048, peakProcesses: 1, ceilingBytes: role === 'frontend' ? 67108864 : 268435456})));
 return {rssPoints, processRss};
}
it('projects only independently recomputed fixed RSS facts', () => {
 const output = publicRssFacts(fixture()); expect(output).toHaveLength(9); expect(JSON.stringify(output)).not.toContain('PRIVATE_CANARY');
});
it('rejects forged summaries, duplicate peers, reordered or missing observations', () => {
 const wrong = fixture(); wrong.processRss[0]!.peakSummedRssBytes = 1; expect(() => publicRssFacts(wrong)).toThrow();
 const duplicate = fixture(); duplicate.rssPoints[0]!.peers[1]!.role = 'frontend'; expect(() => publicRssFacts(duplicate)).toThrow();
 const old = fixture(); old.rssPoints[1]!.at = 0; expect(() => publicRssFacts(old)).toThrow();
 expect(() => publicRssFacts({...fixture(), rssPoints: []})).toThrow();
});
