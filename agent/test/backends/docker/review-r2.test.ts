import { describe, expect, it } from 'vitest';
import { DockerBackend } from '../../../src/backends/docker/index.js';
import type { DockerReply } from '../../../src/backends/docker/index.js';
import { FakeDocker, makePlan, operation, payload } from './fixtures.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('monotonic runtime history under out-of-order inspection', () => {
  it('does not dispatch start from stale created reply after concurrent terminal inspection', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    const held = deferred<DockerReply>(); const reached = deferred<void>();
    let pending = true;
    docker.intercept = input => {
      if (!input.path.endsWith('/json') || !pending) return undefined;
      pending = false; reached.resolve(); return held.promise;
    };
    const start = backend.dispatchStartOnce(plan, operation());
    await reached.promise;
    docker.state = payload(plan, 'exited');
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'exited' });
    held.resolve({ ok: true, status: 200, body: payload(plan) });
    expect((await start).outcome).not.toBe('known');
    expect(docker.mutations()).toHaveLength(0);
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'exited' });
  });
  it('never publishes late created/live evidence over retained terminal evidence', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = deferred<DockerReply>(); const reached = deferred<void>();
    let pending = true;
    docker.intercept = input => {
      if (!input.path.endsWith('/json') || !pending) return undefined;
      pending = false; reached.resolve(); return held.promise;
    };
    const stale = backend.inspect(plan, operation()); await reached.promise;
    docker.state = payload(plan, 'exited');
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'exited' });
    held.resolve({ ok: true, status: 200, body: payload(plan, 'running') });
    expect(await stale).toMatchObject({ state: 'unknown' });
    docker.state = payload(plan);
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'unknown' });
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).not.toBe('known');
    expect(docker.mutations()).toHaveLength(0);
  });
  it('keeps read responsiveness and removal fences while a created inspection is pending', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = deferred<DockerReply>(); const reached = deferred<void>();
    let pending = true;
    docker.intercept = input => {
      if (!input.path.endsWith('/json') || !pending) return undefined;
      pending = false; reached.resolve(); return held.promise;
    };
    const stale = backend.inspect(plan, operation()); await reached.promise;
    docker.state = payload(plan, 'exited');
    expect(await backend.inspect(plan, operation())).toMatchObject({ state: 'exited' });
    expect(await backend.remove(plan, operation(), { sealed: true, applicationAcknowledged: true }))
      .toEqual({ outcome: 'known', value: 'removed' });
    held.resolve({ ok: true, status: 200, body: payload(plan) });
    expect(await stale).toEqual({ state: 'unknown', reason: 'conflict' });
    expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).not.toBe('known');
    expect(docker.mutations().map(call => call.method)).toEqual(['DELETE']);
  });
  it('does not replace an observed runtime identity with a delayed create response', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = deferred<DockerReply>(); const reached = deferred<void>();
    docker.intercept = input => {
      if (!input.path.includes('/create?')) return undefined;
      reached.resolve(); return held.promise;
    };
    const create = backend.ensureCreated(plan, operation()); await reached.promise;
    const observed = { ...payload(plan, 'exited'), Id: 'c'.repeat(64) };
    docker.state = observed;
    expect(await backend.inspect(plan, operation())).toMatchObject({ id: observed.Id, state: 'exited' });
    held.resolve({ ok: true, status: 201, body: { Id: 'b'.repeat(64) } });
    expect((await create).outcome).not.toBe('known');
    expect(await backend.inspect(plan, operation())).toMatchObject({ id: observed.Id, state: 'exited' });
    expect(docker.mutations()).toHaveLength(1);
  });
});

describe('disabled healthcheck merge semantics', () => {
  it('accepts inherited nonzero timing/retry metadata only with exact NONE test', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = payload(plan);
    (data.Config as Record<string, unknown>).Healthcheck = { Test: ['NONE'], Interval: 30_000_000_000,
      Timeout: 3_000_000_000, StartPeriod: 1_000_000_000, StartInterval: 5_000_000_000, Retries: 3 };
    docker.state = data;
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known', value: { state: 'created' } });
    expect(docker.mutations()).toHaveLength(0);
  });
  it.each([{ Test: ['CMD', 'probe'] }, { Test: ['NONE', 'probe'] }, { Test: ['unknown'] },
    { Test: ['NONE'], Interval: '30000000000' }, { Test: ['NONE'], Timeout: null },
    { Test: ['NONE'], Retries: -1 }, { Test: ['NONE'], Retries: 1.5 },
    { Test: ['NONE'], StartPeriod: Number.MAX_SAFE_INTEGER + 1 }, { Test: ['NONE'], FutureUnsafe: 0 }])('rejects executable or malformed disabled-healthcheck metadata %#', async healthcheck => {
      const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
      const data = payload(plan); (data.Config as Record<string, unknown>).Healthcheck = healthcheck;
      docker.state = data;
      expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
      expect(docker.mutations()).toHaveLength(0);
    });
  it('rejects nonempty daemon default-ulimits instead of adopting a broader profile', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const data = payload(plan);
    (data.HostConfig as Record<string, unknown>).Ulimits = [{ Name: 'nofile', Soft: 1024, Hard: 1024 }];
    docker.state = data;
    expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'conflict' });
    expect(docker.mutations()).toHaveLength(0);
  });
});
