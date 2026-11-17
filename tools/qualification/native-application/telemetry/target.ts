import { writeFile } from 'node:fs/promises';
import { ownedOrigin } from '../public-api.js';
import { readContent, hash } from '../compose/public.js';
import assert from 'node:assert/strict';
const program = `const h=require('node:http');const counts={ready:0,work:0,unexpected:0};h.createServer((q,r)=>{
if(q.method==='GET'&&q.url==='/counts'){r.end(JSON.stringify(counts));return;}
if(q.method==='GET'&&q.url==='/ready'){if(++counts.ready>10)process.exit(3);r.end('ok');return;}
if(q.method!=='GET'||q.url!=='/work'){counts.unexpected++;process.exit(4);}
if(++counts.work>45000)process.exit(5);setTimeout(()=>r.end('ok'),10);}).listen(8080,'0.0.0.0');`;
export async function target(path: string, agentImage: string) {
  const origin = await ownedOrigin();
  await writeFile(
    path,
    JSON.stringify({
      services: {
        setup: { environment: { BEETLE_COMPOSE_AGENT_IMAGE: agentImage } },
        agent: { image: agentImage, restart: 'no' },
        'synthetic-target': { entrypoint: ['node', '-e', program], ports: [`127.0.0.1:${new URL(origin).port}:8080`] },
      },
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return {
    sourceSha256: hash(program),
    async counts() {
      const response = await fetch(origin + '/counts', { signal: AbortSignal.timeout(2000), redirect: 'error' });
      const counts: unknown = JSON.parse((await readContent(response, 1024)).toString());
      assert.deepEqual(counts, { ready: 10, work: 40000, unexpected: 0 });
      return counts;
    },
  };
}
