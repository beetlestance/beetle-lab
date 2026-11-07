import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { DockerBackend, runtimeName } from '../../../src/backends/docker/index.js';
import { FakeDocker, id, makeInput, makePlan, operation, payload, unavailable } from './fixtures.js';

describe('Docker creation and identity', () => {
  it('creates once, never starts, and adopts only exact existing identity', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known', value: { state: 'created', id } });
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known' });
    expect(docker.mutations().map(call => call.path)).toEqual([`/v1.47/containers/create?name=${plan.name}`]);
    expect(docker.mutations()[0]?.body).toBe(plan.spec);
    expect(docker.calls.some(call => call.path.includes('/containers/json'))).toBe(false);
  });
  it('reconciles a lost create response without a second creation', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => {
      if (!input.path.includes('/create')) return undefined;
      docker.respond(input); return unavailable();
    };
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
    docker.intercept = undefined;
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known', value: { state: 'created' } });
    expect(docker.mutations()).toHaveLength(1);
  });
  it('fences an uncertain create still missing during delayed visibility', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => input.path.includes('/create') ? unavailable() : undefined;
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
    expect(docker.mutations()).toHaveLength(1);
    docker.state = payload(plan);
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known' });
  });
  it('adopts an exact conflict, and rejects foreign conflicts without a suffix or replacement', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => {
      if (!input.path.includes('/create')) return undefined;
      docker.state = payload(plan); return { ok: true, status: 409, body: { message: 'secret-canary' } };
    };
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known' });
    docker.state = { ...payload(plan), Name: '/foreign' };
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
    expect(docker.mutations()).toHaveLength(1);
  });
  it('separates missing, unavailable, malformed and unknown runtime states', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'missing' });
    docker.intercept = input => input.path.endsWith('/json') ? unavailable() : undefined;
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'unavailable' });
    docker.intercept = undefined; docker.state = { Id: id };
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'malformed' });
    docker.state = payload(plan, 'dead');
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'unknown' });
  });
  it.each(['labels', 'image', 'memory', 'privileged', 'mount', 'extra-mount', 'entrypoint', 'network', 'restart', 'device',
    'extra-network', 'masked-paths', 'dns'])('rejects changed inspect %s', changed => {
    return rejectChanged(changed);
  });
  it('rejects a same-name conflicting local specification', async () => {
    const input = makeInput(); const plan = makePlan(input); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    await backend.ensureCreated(plan, operation());
    input.offer.intentDigest = 'c'.repeat(64);
    expect(await backend.ensureCreated(makePlan(input), operation())).toEqual({ outcome: 'rejected', reason: 'conflict' });
  });
  it.each(['version-low', 'version-high', 'missing-version', 'control'])('rejects unsupported daemon %s before mutation', async kind => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => {
      if (kind === 'control' && input.path.endsWith('/info')) return { ok: true, status: 200, body: { PidsLimit: false } };
      if (!input.path.endsWith('/version')) return undefined;
      if (kind === 'control') return undefined;
      const body = kind === 'missing-version' ? {} : { MinAPIVersion: kind === 'version-high' ? '1.48' : '1.24', ApiVersion: '1.46' };
      return { ok: true, status: 200, body };
    };
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'rejected', reason: 'unsupported' });
    expect(docker.mutations()).toHaveLength(0);
  });
});

async function rejectChanged(changed: string): Promise<void> {
  const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
  const data = payload(plan);
  const config = data.Config as Record<string, unknown>;
  const host = data.HostConfig as Record<string, unknown>;
  const mounts = data.Mounts as Record<string, unknown>[];
  const changes: Record<string, () => void> = {
    labels: () => { config.Labels = { ...plan.spec.Labels, 'dev.beetle.workspace': 'foreign' }; },
    image: () => { data.Image = `sha256:${'d'.repeat(64)}`; }, memory: () => { host.Memory = 1; },
    privileged: () => { host.Privileged = true; }, mount: () => { mounts[0]!.RW = true; },
    'extra-mount': () => { mounts.push({ Destination: '/var/run/docker.sock' }); },
    entrypoint: () => { config.Entrypoint = ['sh']; }, network: () => { host.NetworkMode = 'host'; },
    restart: () => { host.RestartPolicy = { Name: 'always', MaximumRetryCount: 0 }; },
    device: () => { host.Devices = [{ PathOnHost: '/dev/fake' }]; },
    'extra-network': () => { data.NetworkSettings = { Networks: { 'beetle-targets': {}, host: {} } }; },
    'masked-paths': () => { host.MaskedPaths = []; }, dns: () => { host.Dns = ['192.0.2.1']; },
  };
  changes[changed]!();
  docker.state = data;
  expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
  expect(docker.mutations()).toHaveLength(0);
}

describe('single-dispatch start fences', () => {
  it('dispatches once and fences future starts even after exit', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    expect(await backend.dispatchStartOnce(plan, operation())).toMatchObject({ outcome: 'known', value: { state: 'running' } });
    docker.state = payload(plan, 'exited');
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations()).toHaveLength(1);
  });
  it.each(['running', 'exited', 'restarting', 'dead', 'paused'])('never starts observed %s', async state => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, state);
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).not.toBe('known');
    expect(docker.mutations()).toHaveLength(0);
  });
  it('retains unknown-start fence even if a later inspect still reports created', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    docker.intercept = input => input.path.endsWith('/start') ? unavailable() : undefined;
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations()).toHaveLength(1);
  });
  it('retains the start fence after an abort or late successful response', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
      docker.state = payload(plan);
      docker.intercept = input => {
        if (!input.path.endsWith('/start')) return undefined;
        const reply = docker.respond(input); now = 51; return reply;
      };
      expect(await backend.dispatchStartOnce(plan, operation(50))).toEqual({ outcome: 'unknown', reason: 'deadline' });
      expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
      expect(docker.mutations()).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });
  it('rejects duplicate in-flight calls and retains the claim after delayed start response', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    let release: (() => void) | undefined;
    let notify: () => void = () => undefined;
    const started = new Promise<void>(resolve => { notify = resolve; });
    docker.intercept = input => {
      if (!input.path.endsWith('/start')) return undefined;
      notify(); return new Promise(resolve => { release = () => resolve(docker.respond(input)); });
    };
    const first = backend.dispatchStartOnce(plan, operation());
    await started;
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    release!(); expect((await first).outcome).toBe('known');
    expect(docker.mutations()).toHaveLength(1);
  });
  it('bounds the lifetime entry table at 64 and never evicts unknown fences', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.intercept = input => input.path.endsWith('/json') ? unavailable() : undefined;
    for (let index = 0; index < 64; index++) {
      const input = makeInput(); input.offer.attemptId = `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`;
      const name = makePlanForIdentity(input);
      expect((await backend.dispatchStartOnce(name, operation())).outcome).toBe('unknown');
    }
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'overflow' });
    expect(docker.mutations()).toHaveLength(0);
  });
  it('shares one absolute deadline across daemon checks, inspect and mutation', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
      docker.intercept = input => { now += 20; return docker.respond(input); };
      expect(await backend.ensureCreated(plan, operation(50))).toEqual({ outcome: 'unknown', reason: 'deadline' });
      expect(new Set(docker.calls.map(call => call.deadline)).size).toBe(1);
      expect(docker.mutations()).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });
});

function makePlanForIdentity(input: ReturnType<typeof makeInput>) {
  const name = runtimeNameForTest(input);
  const root = `${input.profile.stagingRoot}/${name}`;
  return makePlan({ ...input, staged: { input: `${root}/input`, output: `${root}/output` } });
}
function runtimeNameForTest(input: ReturnType<typeof makeInput>) {
  // Reuse the public staging name contract, not a test-only identity algorithm.
  return runtimeName({ ...input.offer, installationId: input.profile.installationId, generation: input.generation });
}

describe('stop, kill and cleanup evidence', () => {
  it.each(['stop', 'kill'] as const)('verifies known stopped after %s and preserves OOM evidence', async action => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'running');
    const context = operation();
    const result = action === 'stop' ? await backend.stop(plan, context, performance.now() + 500) : await backend.kill(plan, context);
    expect(result).toMatchObject({ outcome: 'known', value: { state: 'exited', oomKilled: false, exitCode: 0 } });
    expect(docker.mutations()[0]?.path).toContain(action === 'stop' ? '/stop?t=0' : '/kill?signal=SIGKILL');
    const data = payload(plan, 'exited'); const state = data.State as Record<string, unknown>; state.ExitCode = 137;
    docker.state = data;
    expect(await backend.inspect(plan, operation())).toMatchObject({ exitCode: 137, oomKilled: false });
    state.OOMKilled = true;
    expect(await backend.inspect(plan, operation())).toMatchObject({ exitCode: 137, oomKilled: true });
  });
  it('returns unknown when stop response is lost or stopped proof is absent', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'running');
    docker.intercept = input => input.path.includes('/stop?') ? unavailable() : undefined;
    expect(await backend.stop(plan, operation(), performance.now())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
    docker.intercept = input => input.path.includes('/kill?') ? { ok: true, status: 204, body: null } : undefined;
    expect(await backend.kill(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unsafe_state' });
  });
  it('requires seal/ack and known stopped identity, removes without force or volumes, verifies absence', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const evidence = { sealed: true, applicationAcknowledged: true } as const;
    expect(await backend.remove(plan, operation(), { sealed: false, applicationAcknowledged: true } as unknown as typeof evidence))
      .toEqual({ outcome: 'rejected', reason: 'cleanup_guard' });
    docker.state = payload(plan, 'running');
    expect(await backend.remove(plan, operation(), evidence)).toEqual({ outcome: 'rejected', reason: 'cleanup_guard' });
    docker.state = payload(plan, 'exited');
    expect(await backend.remove(plan, operation(), evidence)).toEqual({ outcome: 'known', value: 'removed' });
    expect(docker.mutations().map(call => call.path)).toEqual([`/v1.47/containers/${id}?force=false&v=false`]);
  });
  it('never returns removal proof after lost delete response', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'exited');
    docker.intercept = input => input.method === 'DELETE' ? unavailable() : undefined;
    expect(await backend.remove(plan, operation(), { sealed: true, applicationAcknowledged: true }))
      .toEqual({ outcome: 'unknown', reason: 'unavailable' });
  });
});
