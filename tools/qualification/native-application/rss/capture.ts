import assert from 'node:assert/strict';
/** Linux ps RSS is KiB. Summed RSS includes shared pages more than once. */
export function captureRss(text: string) {
 assert(Buffer.byteLength(text) <= 65536); const lines = text.trim().split('\n');
 assert(lines.length >= 2 && lines.length <= 129); assert.deepEqual(lines.shift()!.trim().split(/\s+/), ['PID', 'RSS']);
 const seen = new Set<number>(); let summedRssBytes = 0; let largestProcessRssBytes = 0;
 for (const line of lines) {
  const cells = line.trim().split(/\s+/); assert(cells.length === 2 && cells.every(cell => /^(0|[1-9][0-9]{0,9})$/.test(cell)));
  const pid = Number(cells[0]); const rssKiB = Number(cells[1]); assert(pid > 0 && pid <= 2147483647 && !seen.has(pid)); seen.add(pid);
  const bytes = rssKiB * 1024; assert(Number.isSafeInteger(bytes)); summedRssBytes += bytes; largestProcessRssBytes = Math.max(largestProcessRssBytes, bytes);
 }
 assert(summedRssBytes > 0 && Number.isSafeInteger(summedRssBytes));
 return {processes: seen.size, summedRssBytes, largestProcessRssBytes};
}
