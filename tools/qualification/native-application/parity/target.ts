import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Fixture} from '../compose/fixture.js';
import {ownedOrigin} from '../public-api.js';
import {readContent} from '../compose/public.js';
const routes = ['arrival', 'ramp_arrival', 'ramp_vus', 'constant', 'shared', 'pervu', 'discovery-reached', 'discovery-exhausted', 'slo', 'assertion', 'transport'];
export async function target(f: Fixture) {
 const origin = await ownedOrigin(); const file = join(f.root, 'target.json');
 const override = JSON.parse(await readFile(file, 'utf8')) as {services: {'synthetic-target': Record<string, unknown>}};
 const program = `const routes=${JSON.stringify(routes)};const counts={ready:0,unexpected:0,total:0,work:Object.fromEntries(routes.map(x=>[x,{count:0,firstAt:null}]))};require('node:http').createServer((q,r)=>{if(q.url==='/counts'){r.setHeader('content-type','application/json');r.end(JSON.stringify(counts));return;}if(++counts.total>512)process.exit(3);if(q.url==='/ready'){if(++counts.ready>2)process.exit(3);r.end('ok');return;}const key=q.url?.slice(1);const row=counts.work[key];if(!row){counts.unexpected++;r.writeHead(404);r.end();return;}if(++row.count>128)process.exit(3);if(row.firstAt===null)row.firstAt=Date.now();if(key==='transport'){q.socket.destroy();return;}r.writeHead(key==='assertion'?500:200);r.end('ok');}).listen(8080,'0.0.0.0');`;
 Object.assign(override.services['synthetic-target'], {entrypoint: ['node', '-e', program], ports: [`127.0.0.1:${new URL(origin).port}:8080`]});
 await writeFile(file, JSON.stringify(override), {mode: 0o600});
 return async () => {
  const response = await fetch(origin + '/counts', {redirect: 'error', signal: AbortSignal.timeout(3000)});
  const input: unknown = JSON.parse((await readContent(response, 4096)).toString());
  assert(input && typeof input === 'object'); const value = input as Record<string, unknown>;
  const integer = (n: unknown): number => {assert(typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER); return n;};
  assert(value.work && typeof value.work === 'object'); const work = value.work as Record<string, {count: unknown; firstAt: unknown}>;
  return {ready: integer(value.ready), unexpected: integer(value.unexpected), total: integer(value.total),
   work: Object.fromEntries(routes.map(key => {assert(work[key]); const row = work[key]; return [key, {count: integer(row.count), firstAt: row.firstAt === null ? null : integer(row.firstAt)}];}))};
 };
}
export function ordinaryCounts(counts: Awaited<ReturnType<Awaited<ReturnType<typeof target>>>>) {
 for (const id of routes.slice(0, 6)) assert(counts.work[id]!.count > 0, 'Every executor must issue real work');
 assert.equal(counts.work.shared!.count, 3); assert.equal(counts.work.pervu!.count, 6);
 const first = Math.min(...routes.slice(0, 5).map(id => counts.work[id]!.firstAt!));
 assert(counts.work.pervu!.firstAt! - first >= 800, 'Configured delayed executor start must be observable');
}
