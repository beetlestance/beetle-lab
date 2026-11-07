import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { EngineManifest, Offer } from '@beetle/contracts';
import { prepareRuntime, runtimeName } from '../../../src/backends/docker/index.js';
import type { DockerReply, DockerRequest, DockerTransport, Operation, PrepareInput,
  RuntimePlan } from '../../../src/backends/docker/index.js';

export const id = 'b'.repeat(64);
export function makeInput(): PrepareInput & { offer: Offer; manifest: EngineManifest } {
  const offer = JSON.parse(readFileSync(new URL('../../../../contracts/fixtures/valid/offer.json', import.meta.url), 'utf8')) as Offer;
  const manifest = JSON.parse(readFileSync(new URL('../../../../contracts/fixtures/valid/manifest.json', import.meta.url), 'utf8')) as EngineManifest;
  const profile = { installationId: '00000000-0000-4000-8000-000000000010', imageDigest: manifest.imageDigest,
    effectiveImage: { imageDigest: manifest.imageDigest, environment: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      defaultRuntime: 'runc' },
    entrypoint: manifest.entrypoint, user: '10001:10001', stagingRoot: '/var/lib/beetle/staged',
    network: { profile: 'target-egress' as const, name: 'beetle-targets' }, tmpfsBytes: 1_048_576,
    maximumBudget: { ...offer.budget } };
  const name = runtimeName({ ...offer, installationId: profile.installationId, generation: 1 });
  const root = `${profile.stagingRoot}/${name}`;
  return { offer, manifest, profile, generation: 1,
    staged: { input: `${root}/input`, output: `${root}/output`, secrets: `${root}/secrets` } };
}
export function makePlan(input = makeInput()): RuntimePlan {
  const result = prepareRuntime(input);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
export function operation(ms = 1000): Operation { return { deadline: performance.now() + ms }; }
export function payload(plan: RuntimePlan, state = 'created'): Record<string, unknown> {
  const host = structuredClone(plan.spec.HostConfig);
  return { Id: id, Name: `/${plan.name}`, Image: plan.spec.Image,
    Config: { Image: plan.spec.Image, Labels: { ...plan.spec.Labels }, User: plan.spec.User,
      Entrypoint: [...plan.spec.Entrypoint], Cmd: [...plan.spec.Cmd], WorkingDir: plan.spec.WorkingDir,
      Env: [...plan.spec.Env], Healthcheck: { ...plan.spec.Healthcheck }, StopSignal: plan.spec.StopSignal,
      NetworkDisabled: plan.spec.NetworkDisabled }, HostConfig: host,
    Mounts: plan.spec.HostConfig.Mounts.map(mount => ({ Type: mount.Type, Source: mount.Source,
      Destination: mount.Target, RW: !mount.ReadOnly, Propagation: mount.BindOptions.Propagation })),
    NetworkSettings: { Networks: { [plan.spec.HostConfig.NetworkMode]: {} } },
    State: { Status: state, Running: ['running', 'restarting', 'paused'].includes(state),
      OOMKilled: false, ExitCode: 0, Paused: state === 'paused', Restarting: state === 'restarting', Dead: state === 'dead' } };
}
export const unavailable = (): DockerReply => ({ ok: false, reason: 'unavailable', dispatched: true });
export class FakeDocker implements DockerTransport {
  readonly calls: DockerRequest[] = [];
  state: Record<string, unknown> | undefined;
  intercept: ((input: DockerRequest) => Promise<DockerReply> | DockerReply | undefined) | undefined;
  constructor(readonly plan: RuntimePlan) {}
  async request(input: DockerRequest): Promise<DockerReply> {
    this.calls.push(input);
    const intercepted = this.intercept?.(input);
    return intercepted === undefined ? this.respond(input) : await intercepted;
  }
  respond(input: DockerRequest): DockerReply {
    if (input.path === '/version') return { ok: true, status: 200, body: { MinAPIVersion: '1.24', ApiVersion: '1.47' } };
    if (input.path === '/v1.47/info') return { ok: true, status: 200, body: { MemoryLimit: true,
      SwapLimit: true, CpuCfsPeriod: true, CpuCfsQuota: true, PidsLimit: true, OSType: 'linux',
      DefaultRuntime: 'runc', KernelVersion: '6.6.0' } };
    if (input.method === 'GET') return this.inspectReply();
    if (input.path.includes('/create')) {
      this.state = payload(this.plan);
      return { ok: true, status: 201, body: { Id: id, Warnings: [] } };
    }
    if (input.path.endsWith('/start')) this.state = payload(this.plan, 'running');
    if (input.path.includes('/stop?') || input.path.includes('/kill?')) this.state = payload(this.plan, 'exited');
    if (input.method === 'DELETE') this.state = undefined;
    return { ok: true, status: 204, body: null };
  }
  private inspectReply(): DockerReply { return { ok: true, status: this.state ? 200 : 404, body: this.state ?? null }; }
  mutations(): DockerRequest[] { return this.calls.filter(input => input.method !== 'GET'); }
}
