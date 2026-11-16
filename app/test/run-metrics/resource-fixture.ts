import { fixture, rewrite } from './fixture.js';
/** Synthetic boundary vector; exact wrapper bytes have their separate fixture/test. */
export async function resourceFixture(windows: number, dimensions = 1, missing = false) {
  const f = await fixture(); f.chunkSize.bytes = 65536;
  const data = f.descriptors.find(a => a.kind === 'metric-windows')!;
  const index = f.descriptors.find(a => a.kind === 'metric-index')!;
  const dataHeader = f.contents.get(data.artifactId)!.toString().split('\n')[0]! + '\n';
  const indexHeader = f.contents.get(index.artifactId)!.toString().split('\n')[0]! + '\n';
  const totals = Array.from({length: dimensions}, (_, i) => ({metric: `counter_${i}`, kind: 'counter' as const, scope: 'execute' as const,
    tags: dimensions === 1 ? {} : {request: 'r'.repeat(128), assertion: 'a'.repeat(128)}, total: {kind: 'counter' as const, sum: missing ? windows / 2 : windows}}));
  const records: string[] = [dataHeader]; const rows: string[] = [indexHeader]; let offset = Buffer.byteLength(dataHeader);
  for (let i = 1; i <= windows; i++) {
    const startTimeMs = 1800000000000 + i * 1000; const endTimeMs = startTimeMs + 1000;
    const series = missing && i % 2 ? [] : totals.map(s => ({...s, total: {kind: 'counter', sum: 1}}));
    const text = JSON.stringify({kind: 'window', sequence: i, window: {startTimeMs, endTimeMs, series}}) + '\n';
    const length = Buffer.byteLength(text); records.push(text); rows.push(JSON.stringify({sequence: i, startTimeMs, endTimeMs, offset, length}) + '\n'); offset += length;
  }
  records.push(JSON.stringify({kind: 'end', windows}) + '\n');
  rewrite(f, 'metric-windows', () => records.join(''));
  rows.push(JSON.stringify({kind: 'end', windows, dataBytes: data.bytes, dataSha256: data.sha256}) + '\n');
  rewrite(f, 'metric-index', () => rows.join(''));
  rewrite(f, 'numeric-final', text => {const n = JSON.parse(text) as {history: {bytes: number; windows: number}; metrics: {totals: unknown[]}};
    n.history.bytes = data.bytes + index.bytes; n.history.windows = windows; n.metrics.totals = totals; return JSON.stringify(n);});
  return f;
}
