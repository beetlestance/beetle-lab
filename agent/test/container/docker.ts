import { execFileSync } from 'node:child_process';

/** Manual qualification only: explicit local context, fixed API and bounded subprocesses. */
export class Docker {
  private readonly environment: NodeJS.ProcessEnv = { ...process.env, DOCKER_API_VERSION: '1.47' };
  constructor(private readonly context: string, private readonly maximumNetworks: 1 | 2 = 1) {
    if (maximumNetworks !== 1 && maximumNetworks !== 2) throw new Error('Invalid qualification network limit');
    delete this.environment.DOCKER_HOST; delete this.environment.DOCKER_CONTEXT;
    const endpoint = this.run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
    if (!endpoint.startsWith('unix://')) throw new Error('A local Unix Docker context is required');
  }
  run(args: string[], input?: string): string {
    try {
      return execFileSync('docker', ['--context', this.context, ...args], { env: this.environment,
        encoding: 'utf8', input, timeout: 60_000, maxBuffer: 2_097_152, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { throw new Error(`Qualification Docker operation failed: ${args[0]}`); }
  }
  json<T>(args: string[]): T { return JSON.parse(this.run(args)) as T; }
  ownedIds(installationId: string): string[] {
    const labels = [`dev.beetle.qualification=${installationId}`, `dev.beetle.installation=${installationId}`];
    const ids = [...new Set(labels.flatMap(label => this.run(['ps', '-aq', '--no-trunc', '--filter', `label=${label}`]).split('\n').filter(Boolean)))];
    if (ids.length > 8 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid qualification ownership inventory');
    return ids;
  }
  cleanup(installationId: string): void {
    const failures: string[] = [];
    for (const id of this.ownedIds(installationId)) {
      try { this.run(['rm', '-f', id]); } catch { failures.push('container'); }
    }
    const networks = this.run(['network', 'ls', '-q', '--no-trunc', '--filter', `label=dev.beetle.qualification=${installationId}`])
      .split('\n').filter(Boolean);
    if (networks.length > this.maximumNetworks) throw new Error('Invalid qualification network inventory');
    for (const id of networks) { try { this.run(['network', 'rm', id]); } catch { failures.push('network'); } }
    if (failures.length || this.ownedIds(installationId).length || this.run(['network', 'ls', '-q', '--filter',
      `label=dev.beetle.qualification=${installationId}`])) throw new Error('Qualification cleanup remains incomplete');
  }
}

export interface Image { Id: string; Os: string; Architecture: string; Config: { Env: string[] } }
export interface Daemon { ID: string; OSType: string; Architecture: string; DefaultRuntime: string; ServerVersion: string }
export interface Inspection {
  Image: string; State: { Running: boolean; ExitCode: number; OOMKilled: boolean };
  HostConfig: { NanoCpus: number; Memory: number; MemorySwap: number; PidsLimit: number; ReadonlyRootfs: boolean };
}
const client = `const fs=require('node:fs');const q=JSON.parse(fs.readFileSync(0,'utf8'));
const token=fs.readFileSync(process.argv[1],'utf8');
fetch('http://127.0.0.1:4312'+q.path,{method:q.method,headers:{authorization:'Bearer '+token,...q.headers},
...(q.body?{body:JSON.stringify(q.body)}:{}),signal:AbortSignal.timeout(3000)}).then(async r=>{
const reader=r.body.getReader();const chunks=[];let bytes=0;
while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;
if(bytes>1048576){await reader.cancel();throw Error('reply limit');}chunks.push(Buffer.from(p.value));}
console.log(JSON.stringify({status:r.status,body:Buffer.concat(chunks,bytes).toString('utf8')}));
}).catch(()=>process.exit(2));`;
export function request(docker: Docker, input: {
  agent: string; credentialFile: string; headers?: Record<string, string>; path: string; method?: string; body?: unknown;
}): { status: number; body: string } {
  const { path, method = 'GET', headers = {}, body } = input;
  return JSON.parse(docker.run(['exec', '-i', input.agent, 'node', '-e', client, input.credentialFile],
    JSON.stringify({ path, method, headers, body }))) as { status: number; body: string };
}
