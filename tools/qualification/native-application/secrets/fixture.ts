import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import type {Fixture} from '../compose/fixture.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function secretTarget(f: Fixture) {
 const canaries = [0, 1].map(() => 'beetle-private-' + randomBytes(24).toString('hex'));
 const file = join(f.root, 'target.json'); const override = JSON.parse(await readFile(file, 'utf8')) as {services: Record<string, Record<string, unknown>>};
 const program = `const crypto=require('node:crypto'),expected=${JSON.stringify(canaries.map(digest))};const counts={ready:0,work:0,rejected:0};require('node:http').createServer((q,r)=>{if(q.url==='/counts'){r.end(JSON.stringify(counts));return;}if(q.url==='/ready'){if(++counts.ready>2)process.exit(3);r.end('ok');return;}if(q.url!=='/work'||++counts.work>6)process.exit(3);const actual=['x-environment','x-mounted'].map(k=>crypto.createHash('sha256').update(q.headers[k]||'').digest('hex'));if(actual.some((v,i)=>v!==expected[i])){counts.rejected++;r.writeHead(403);}r.end('ok');}).listen(8080,'0.0.0.0');`;
 override.services['synthetic-target']!.entrypoint = ['node', '-e', program]; await writeFile(file, JSON.stringify(override), {mode: 0o600});
 return canaries;
}
/** Copy the immutable default config to an explicit private operator override; never rewrite its receipt. */
export async function bindSecrets(f: Fixture, scope: {organizationId: string; workspaceId: string}, canaries: readonly string[], owner: string) {
 assert(canaries.length === 2 && /^[a-f0-9-]{36}$/.test(owner));
 const original = join(f.home, 'data/config/agent.json'); const configured = join(f.home, `secrets-agent-${scope.workspaceId}.json`); const mounted = join(f.home, 'mounted-secret');
 const bindings = [{...scope, name: 'environment', provider: 'env', reference: 'environment-ref', version: 'v1', source: 'BEETLE_TEST_SECRET'},
 {...scope, name: 'mounted', provider: 'mounted', reference: 'mounted-ref', version: 'v1', source: mounted}];
 const program = "const f=require('node:fs'),c=require('node:crypto');process.umask(0o077);const raw=f.readFileSync(process.argv[1]);if(raw.length>262144)process.exit(3);const config=JSON.parse(raw);const data=JSON.parse(f.readFileSync(0));config.providers.secretBindings=data.bindings;f.writeFileSync(process.argv[2],JSON.stringify(config),{flag:'wx',mode:0o600});if(f.existsSync(process.argv[3])){if(f.readFileSync(process.argv[3],'utf8')!==data.mounted)process.exit(4);}else f.writeFileSync(process.argv[3],data.mounted,{flag:'wx',mode:0o600});console.log(c.createHash('sha256').update(raw).digest('hex'));";
 const before = f.docker.run(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
 '--cpus', '.5', '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '32', '--label', `dev.beetle.qualification=${owner}`, '--label', `com.docker.compose.project=${f.project}`, '--label', `org.opencontainers.image.revision=${f.revision}`, '--user', '1000:1000', '--mount', `type=bind,src=${f.home},dst=${f.home}`,
 '-i', '--entrypoint', 'node', f.images.installer!, '-e', program, original, configured, mounted], JSON.stringify({bindings, mounted: canaries[1]}));
 assert(/^[a-f0-9]{64}$/.test(before));
 const file = join(f.root, 'target.json'); const override = JSON.parse(await readFile(file, 'utf8')) as {services: Record<string, unknown>};
 override.services.agent = {environment: {BEETLE_AGENT_CONFIG_FILE: configured, BEETLE_TEST_SECRET: canaries[0]},
 volumes: [{type: 'bind', source: configured, target: configured, read_only: true}, {type: 'bind', source: mounted, target: mounted, read_only: true}]};
 await writeFile(file, JSON.stringify(override), {mode: 0o600});
 f.compose('up', '-d', '--no-build', '--no-deps', 'agent');
 return {defaultConfigSha256: before};
}
export function targetCounts(f: Fixture) {
 const id = f.compose('ps', '-q', 'synthetic-target'); assert(/^[a-f0-9]{64}$/.test(id));
 return f.docker.json<unknown>(['exec', id, 'node', '-e', "fetch('http://127.0.0.1:8080/counts',{signal:AbortSignal.timeout(2000)}).then(r=>r.text()).then(s=>{if(s.length>256)process.exit(3);console.log(s)}).catch(()=>process.exit(2));"]);
}
