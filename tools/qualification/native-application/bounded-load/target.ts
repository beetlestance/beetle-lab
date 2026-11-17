import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Fixture } from '../compose/fixture.js';
import { ownedOrigin } from '../public-api.js';
import { readContent, hash } from '../compose/public.js';
import { record, counter } from '../../resources/values.js';
const program = `const {createServer}=require('node:http');
const counts={ready:0,work:0,unexpected:0};const seen=new Set();
createServer((q,r)=>{const u=new URL(q.url,'http://target');if(q.method==='GET'&&u.pathname==='/counts'){r.end(JSON.stringify({...counts,unique:seen.size}));return;}
const ready=q.method==='GET'&&q.url==='/ready';const work=q.method==='GET'&&u.pathname==='/work'&&/^[1-9][0-9]{0,4}$/.test(u.searchParams.get('key')||'')&&Number(u.searchParams.get('key'))<=10000&&[...u.searchParams.keys()].join(',')==='key';
const key=ready?'ready':work?'work':'unexpected';counts[key]++;if(counts.ready>4||counts.work>1600||counts.unexpected>0)process.exit(3);if(work){seen.add(u.searchParams.get('key'));if(seen.size>1600)process.exit(4);}r.writeHead(key==='unexpected'?404:200);r.end('ok');}).listen(8080,'0.0.0.0');`;
export async function target(f: Fixture) {
  const origin = await ownedOrigin();
  const path = join(f.root, 'target.json');
  const override = JSON.parse(await readFile(path, 'utf8')) as {
    services: { 'synthetic-target': Record<string, unknown> };
  };
  Object.assign(override.services['synthetic-target'], {
    entrypoint: ['node', '-e', program],
    ports: [`127.0.0.1:${new URL(origin).port}:8080`],
  });
  await writeFile(path, JSON.stringify(override), { mode: 0o600 });
  return {
    sourceSha256: hash(program),
    async counts() {
      const response = await fetch(origin + '/counts', { redirect: 'error', signal: AbortSignal.timeout(3000) });
      const row = record(JSON.parse((await readContent(response, 1024)).toString()));
      const facts = {
        ready: counter(row.ready),
        work: counter(row.work),
        unexpected: counter(row.unexpected),
        unique: counter(row.unique),
      };
      assert(facts.ready <= 4 && facts.work <= 1600 && facts.unexpected === 0 && facts.unique <= facts.work);
      return facts;
    },
  };
}
