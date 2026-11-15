import { execFileSync,spawnSync } from 'node:child_process';

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
  /** Task diagnostics need both streams; docker logs writes container stderr to its stderr. */
  logs(id:string):string{
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid qualification log identity');
    const result=spawnSync('docker',['--context',this.context,'logs','--tail','64',id],{env:this.environment,encoding:'utf8',timeout:10000,maxBuffer:1048576});
    if(result.error||result.status!==0)throw new Error('Qualification Docker logs failed');return [result.stdout,result.stderr].filter(Boolean).join('\n');
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
