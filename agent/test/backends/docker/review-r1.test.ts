import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { DockerBackend, prepareRuntime } from '../../../src/backends/docker/index.js';
import { FakeDocker, makeInput, makePlan, operation, payload } from './fixtures.js';

const inheritedEnvironment = ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'];
function baselineInput() {
  const input = makeInput();
  return { ...input, profile: { ...input.profile, effectiveImage: {
    imageDigest: input.manifest.imageDigest, environment: inheritedEnvironment, defaultRuntime: 'runc' } } };
}
function imagePayload(plan: ReturnType<typeof makePlan>, state = 'created') {
  const data = payload(plan, state);
  const config = data.Config as Record<string, unknown>;
  config.Env = [...inheritedEnvironment]; config.Healthcheck = { Test: ['NONE'] };
  const host = data.HostConfig as Record<string, unknown>;
  host.Runtime = 'runc'; host.OomKillDisable = false;
  return data;
}

describe('review corrections: Docker effective defaults and controls', () => {
  it.each(['target-egress', 'none', 'none-null'] as const)('accepts normal %s network encoding and inherited PATH', async network => {
    let input = baselineInput();
    if (network !== 'target-egress') {
      input.manifest.network = { required: false, profile: 'none' };
      input = { ...input, profile: { ...input.profile, network: { profile: 'none', name: 'none' } } };
    }
    const plan = makePlan(input); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = imagePayload(plan);
    if (network === 'target-egress') delete (data.Config as Record<string, unknown>).NetworkDisabled;
    else data.NetworkSettings = { Networks: network === 'none-null' ? null : {} };
    docker.state = data;
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known', value: { state: 'created' } });
  });
  it('pins trusted inherited environment/runtime and explicitly disables image healthchecks', () => {
    const input = baselineInput(); input.offer.config = { Env: ['TOKEN=job-canary'], Runtime: 'untrusted' };
    const plan = makePlan(input);
    expect(plan.spec).toMatchObject({ Env: inheritedEnvironment, Healthcheck: { Test: ['NONE'] },
      HostConfig: { Runtime: 'runc', OomKillDisable: false } });
    expect(JSON.stringify(plan.spec)).not.toContain('job-canary');
  });
  it.each(['env', 'healthcheck', 'runtime', 'oom', 'summary-bind', 'host-bind', 'unknown-bind'])('rejects unapproved effective %s', async changed => {
    const plan = makePlan(baselineInput()); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = imagePayload(plan);
    const config = data.Config as Record<string, unknown>;
    const host = data.HostConfig as Record<string, unknown>;
    const summary = (data.Mounts as Record<string, unknown>[])[0]!;
    const hostMount = (host.Mounts as Record<string, unknown>[])[0]!;
    const changes: Record<string, () => void> = {
      env: () => { config.Env = [...inheritedEnvironment, 'LD_PRELOAD=/tmp/evil.so']; },
      healthcheck: () => { config.Healthcheck = { Test: ['CMD', 'unapproved-probe'] }; },
      runtime: () => { host.Runtime = 'unapproved'; }, oom: () => { host.OomKillDisable = true; },
      'summary-bind': () => { summary.BindOptions = { ReadOnlyNonRecursive: true }; },
      'host-bind': () => { hostMount.BindOptions = { Propagation: 'rprivate', ReadOnlyNonRecursive: true }; },
      'unknown-bind': () => { hostMount.BindOptions = { Propagation: 'rprivate', FutureUnsafe: true }; },
    };
    changes[changed]!(); docker.state = data;
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
    expect(docker.mutations()).toHaveLength(0);
  });
  it('rejects incomplete, mismatched, duplicate-key and oversized trusted environment baselines', () => {
    const input = baselineInput();
    const baseline = input.profile.effectiveImage;
    const invalid = [undefined, { ...baseline, imageDigest: `sha256:${'f'.repeat(64)}` }, { ...baseline, defaultRuntime: null },
      { ...baseline, environment: ['PATH=one', 'PATH=two'] }, { ...baseline, environment: ['TOKEN'] },
      { ...baseline, environment: ['A=' + 'x'.repeat(16_385)] },
      { ...baseline, environment: Array.from({ length: 65 }, (_, index) => `A${index}=x`) }];
    for (const effectiveImage of invalid) {
      const profile = { ...input.profile, effectiveImage };
      expect(prepareRuntime({ ...input, profile } as unknown as Parameters<typeof prepareRuntime>[0]).ok).toBe(false);
    }
  });
  it('accepts only documented empty/false omissions and harmless daemon defaults', async () => {
    const plan = makePlan(baselineInput()); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = imagePayload(plan); const host = data.HostConfig as Record<string, unknown>;
    delete host.Sysctls; delete host.StorageOpt;
    Object.assign(host, { ContainerIDFile: '', VolumeDriver: '', ConsoleSize: [0, 0], Cgroup: '', OomScoreAdj: 0,
      Isolation: '', CgroupParent: '', BlkioWeight: 0, CpuShares: 0, CpuPeriod: 0, CpuQuota: 0, CpusetCpus: '',
      KernelMemory: 0, MemoryReservation: 0, MemorySwappiness: null, Ulimits: null, Annotations: {} });
    for (const mount of host.Mounts as Record<string, unknown>[]) {
      const options = mount.BindOptions as Record<string, unknown>;
      for (const key of Object.keys(options)) if (options[key] === false) delete options[key];
      if (mount.ReadOnly === false) delete mount.ReadOnly;
    }
    (data.Config as Record<string, unknown>).Healthcheck = { Test: ['NONE'], Interval: 0, Retries: 0 };
    docker.state = data;
    expect((await backend.ensureCreated(plan, operation())).outcome).toBe('known');
  });
  it.each(['missing-ro', 'mountpoint', 'future-host', 'health-extra'])('rejects unapproved %s instead of normalizing it', async changed => {
    const plan = makePlan(baselineInput()); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = imagePayload(plan); const host = data.HostConfig as Record<string, unknown>;
    const options = ((host.Mounts as Record<string, unknown>[])[0]!.BindOptions) as Record<string, unknown>;
    const changes: Record<string, () => void> = {
      'missing-ro': () => { delete options.ReadOnlyForceRecursive; },
      mountpoint: () => { options.CreateMountpoint = true; },
      'future-host': () => { host.FutureUnsafe = true; },
      'health-extra': () => { (data.Config as Record<string, unknown>).Healthcheck = { Test: ['NONE'], FutureUnsafe: true }; },
    };
    changes[changed]!(); docker.state = data;
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
    expect(docker.mutations()).toHaveLength(0);
  });
  it.each(['old-kernel', 'unknown-kernel', 'runtime'])('rejects unsupported %s without weaker bind/runtime fallback', async changed => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => {
      if (!input.path.endsWith('/info')) return undefined;
      const info = docker.respond(input);
      if (!info.ok) throw new Error('fixture');
      const body = info.body as Record<string, unknown>;
      if (changed === 'runtime') body.DefaultRuntime = 'unknown';
      else body.KernelVersion = changed === 'old-kernel' ? '5.11.20' : 'unknown';
      return { ...info, body };
    };
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'rejected', reason: 'unsupported' });
    expect(docker.mutations()).toHaveLength(0);
  });
});

describe('review corrections: lifetime adoption and cancellation', () => {
  it('never recreates or restarts an adopted exited attempt after guarded removal', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'exited');
    expect((await backend.ensureCreated(plan, operation())).outcome).toBe('known');
    expect(await backend.remove(plan, operation(), { sealed: true, applicationAcknowledged: true }))
      .toEqual({ outcome: 'known', value: 'removed' });
    expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).not.toBe('known');
    expect(docker.mutations().map(call => call.method)).toEqual(['DELETE']);
  });
  it('fences disappearance and replacement runtime identity after read-only adoption', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'running');
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'running' });
    docker.state = undefined;
    expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
    docker.state = { ...payload(plan), Id: 'c'.repeat(64) };
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'conflict' });
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).not.toBe('known');
    expect(docker.mutations()).toHaveLength(0);
  });
  it('keeps original grace independent of short HTTP deadline and rounds conservatively', async () => {
    let now = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
      docker.state = payload(plan, 'running');
      docker.intercept = input => {
        if (!input.path.includes('/stop?')) return undefined;
        now += 1001; return { ok: true, status: 204, body: null };
      };
      expect(await backend.stop(plan, operation(1000), 5000)).toEqual({ outcome: 'unknown', reason: 'deadline' });
      expect(docker.mutations()[0]?.path).toContain('/stop?t=5');
      expect(await backend.stop(plan, operation(1000), 10_000)).toEqual({ outcome: 'unknown', reason: 'deadline' });
      expect(docker.mutations()[1]?.path).toContain('/stop?t=4');
    } finally { clock.mockRestore(); }
  });
  it('retains the first grace even when qualification initially fails', async () => {
    let now = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
      docker.state = payload(plan, 'running');
      docker.intercept = () => ({ ok: false, reason: 'unavailable', dispatched: false });
      expect((await backend.stop(plan, operation(), 5000)).outcome).toBe('rejected');
      now = 1001; docker.intercept = undefined;
      expect((await backend.stop(plan, operation(), 20_000)).outcome).toBe('known');
      expect(docker.mutations()[0]?.path).toContain('/stop?t=4');
    } finally { clock.mockRestore(); }
  });
});
