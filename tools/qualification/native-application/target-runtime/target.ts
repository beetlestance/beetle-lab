import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Fixture } from '../compose/fixture.js';
import { sourceValues } from './config.js';
export async function target(
  f: Fixture,
  withGcEvidence = false,
  readings: Readonly<Record<string, number>> = {},
  readinessFailures = 0,
) {
  assert(Number.isInteger(readinessFailures) && readinessFailures >= 0 && readinessFailures <= 4);
  const path = join(f.root, 'target.json');
  const override = JSON.parse(await readFile(path, 'utf8')) as { services: Record<string, Record<string, unknown>> };
  const program = `const data=${JSON.stringify({ ...sourceValues, ...readings })};const counts={ready:0,work:0,runtime:0,unexpected:0};require('node:http').createServer((q,r)=>{if(q.url==='/counts'){r.end(JSON.stringify(counts));return;}if(q.url==='/ready'){if(++counts.ready>${readinessFailures + 1})process.exit(3);r.statusCode=counts.ready<=${readinessFailures}?503:200;r.end('ok');return;}if(q.url==='/work'){if(++counts.work>40)process.exit(3);r.end('ok');return;}if(q.url!=='/runtime'){counts.unexpected++;r.writeHead(404);r.end();return;}const n=++counts.runtime;if(n>32)process.exit(3);if(n===2){r.end('not-json');return;}if(n===3){r.writeHead(503);r.end('unavailable');return;}r.setHeader('content-type','application/json');r.end(JSON.stringify(${withGcEvidence} ? {...data, gc:{...data.gc, pauseWindow:{generation:1,through:n,recentMs:Array(Math.min(16,n)).fill(11)}}} : data));}).listen(8080,'0.0.0.0');`;
  assert(Buffer.byteLength(program) <= 8192);
  override.services['synthetic-target']!.entrypoint = ['node', '-e', program];
  await writeFile(path, JSON.stringify(override), { mode: 0o600 });
}
export function targetCounts(f: Fixture) {
  const id = f.compose('ps', '-q', 'synthetic-target');
  assert(/^[a-f0-9]{64}$/.test(id));
  return f.docker.json<{ ready: number; work: number; runtime: number; unexpected: number }>([
    'exec',
    id,
    'node',
    '-e',
    "fetch('http://127.0.0.1:8080/counts',{signal:AbortSignal.timeout(2000)}).then(r=>r.text()).then(s=>{if(s.length>256)process.exit(3);console.log(s)}).catch(()=>process.exit(2));",
  ]);
}
