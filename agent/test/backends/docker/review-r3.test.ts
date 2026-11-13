import { liveFixture } from './mailbox-volume-fixtures.js';
import { describe, expect, it } from 'vitest';
import { DockerBackend } from '../../../src/backends/docker/index.js';
import type { DockerReply } from '../../../src/backends/docker/index.js';
import { FakeDocker, id, makePlan, operation, payload } from './fixtures.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function holdNextInspect(docker: FakeDocker) {
  const reached = deferred<void>(); const reply = deferred<DockerReply>();
  let pending = true; let captured: DockerReply | undefined;
  docker.intercept = input => {
    if (!input.path.endsWith('/json') || !pending) return undefined;
    pending = false; captured = docker.respond(input); reached.resolve(); return reply.promise;
  };
  return { reached: reached.promise, release: () => {
    if (!captured) throw new Error('fixture_not_reached');
    reply.resolve(captured);
  } };
}

describe('absence observations belong to issue-time runtime identity', () => {
  it('never publishes/fences an old404 after concurrent creation succeeds', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = holdNextInspect(docker);
    const oldInspection = backend.inspect(plan, operation()); await held.reached;
    expect(await backend.ensureCreated(plan, operation())).toMatchObject({ outcome: 'known', value: { id, state: 'created' } });
    held.release();
    expect(await oldInspection).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'created' });
    expect(await backend.dispatchStartOnce(plan, operation())).toMatchObject({ outcome: 'known', value: { id, state: 'running' } });
    expect(docker.mutations().map(call => call.path)).toEqual([
      `/v1.47/containers/create?name=${plan.name}`, `/v1.47/containers/${id}/start`,
    ]);
  });
  it('revalidates missing when discovery occurs before the caller resumes', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const absentReply = deferred<DockerReply>(); const presentReply = deferred<DockerReply>();
    const absentReached = deferred<void>(); const presentReached = deferred<void>();
    let reads = 0;
    docker.intercept = input => {
      if (!input.path.endsWith('/json')) return undefined;
      reads++;
      if (reads === 1) { absentReached.resolve(); return absentReply.promise; }
      if (reads === 2) { presentReached.resolve(); return presentReply.promise; }
      return undefined;
    };
    const absent = backend.inspect(plan, operation()); await absentReached.promise;
    const present = backend.inspect(plan, operation()); await presentReached.promise;
    // Both await chains advance together: observe handles404 before discovery,
    // then the positive reply records identity before inspect publishes the404 view.
    absentReply.resolve({ ok: true, status: 404, body: null });
    presentReply.resolve({ ok: true, status: 200, body: payload(plan) });
    expect(await absent).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    expect(await present).toMatchObject({ id, state: 'created' });
    docker.state = payload(plan);
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'created' });
    expect((await backend.dispatchStartOnce(plan, operation())).outcome).toBe('known');
    expect(docker.mutations().map(call => call.path)).toEqual([`/v1.47/containers/${id}/start`]);
  });
  it('retains discovered container identity while volume verification is held and then fails', async () => {
    const { plan, docker } = liveFixture(); await new DockerBackend(docker).ensureCreated(plan, operation());
    const backend = new DockerBackend(docker); const absentReply = deferred<DockerReply>();
    const volumeReply = deferred<DockerReply>(); const absentReached = deferred<void>(); const volumeReached = deferred<void>();
    let inspections = 0;
    docker.intercept = input => {
      if (input.path.endsWith('/json') && ++inspections === 1) { absentReached.resolve(); return absentReply.promise; }
      if (input.path.startsWith('/v1.47/volumes/')) { volumeReached.resolve(); return volumeReply.promise; }
      return undefined;
    };
    const absent = backend.inspect(plan, operation()); await absentReached.promise;
    const present = backend.inspect(plan, operation());
    try {
      await volumeReached.promise; absentReply.resolve({ ok: true, status: 404, body: null });
      expect(await absent).toEqual({ state: 'unknown', reason: 'unsafe_state' });
      volumeReply.resolve({ ok: false, reason: 'unavailable', dispatched: true });
      expect(await present).toEqual({ state: 'unknown', reason: 'unavailable' });
      docker.intercept = undefined; docker.state = undefined; const before = docker.mutations();
      expect(await backend.ensureCreated(plan, operation())).toEqual({ outcome: 'unknown', reason: 'unavailable' });
      expect(docker.mutations()).toEqual(before);
    } finally {
      absentReply.resolve({ ok: true, status: 404, body: null });
      volumeReply.resolve({ ok: false, reason: 'unavailable', dispatched: true });
      await Promise.allSettled([absent, present]);
    }
  });
  it.each(['created', 'exited'])('treats pre-discovery absence as unknown after %s adoption', async state => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = holdNextInspect(docker);
    const absent = backend.inspect(plan, operation()); await held.reached;
    docker.state = payload(plan, state);
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state });
    held.release();
    expect(await absent).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state });
    const start = await backend.dispatchStartOnce(plan, operation());
    expect(start.outcome).toBe(state === 'created' ? 'known' : 'rejected');
    expect(docker.mutations()).toHaveLength(state === 'created' ? 1 : 0);
  });
  it('keeps genuine post-discovery disappearance fenced with authoritative missing evidence', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'created' });
    docker.state = undefined;
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'missing' });
    expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
    docker.state = payload(plan);
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations()).toHaveLength(0);
  });
  it('retains genuine disappearance against an older created reply and preserves terminal identity', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan);
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'created' });
    const held = holdNextInspect(docker);
    const created = backend.inspect(plan, operation()); await held.reached;
    docker.state = undefined;
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'missing' });
    held.release();
    expect(await created).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    docker.state = payload(plan, 'exited');
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'exited' });
    docker.state = { ...payload(plan, 'exited'), Id: 'c'.repeat(64) };
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'conflict' });
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations()).toHaveLength(0);
  });
  it('never erases a removal fence with a pre-discovery absence reply', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    const held = holdNextInspect(docker);
    const absent = backend.inspect(plan, operation()); await held.reached;
    docker.state = payload(plan, 'exited');
    expect(await backend.remove(plan, operation(), { sealed: true, applicationAcknowledged: true }))
      .toEqual({ outcome: 'known', value: 'removed' });
    held.release();
    expect(await absent).toEqual({ state: 'unknown', reason: 'unsafe_state' });
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'missing' });
    expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations().map(call => call.method)).toEqual(['DELETE']);
  });
  it('rejects a delayed exited reply after guarded removal without changing runtime identity', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    docker.state = payload(plan, 'exited');
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'exited' });
    const held = holdNextInspect(docker);
    const exited = backend.inspect(plan, operation()); await held.reached;
    expect(await backend.remove(plan, operation(), { sealed: true, applicationAcknowledged: true }))
      .toEqual({ outcome: 'known', value: 'removed' });
    held.release();
    expect(await exited).toEqual({ state: 'unknown', reason: 'conflict' });
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'missing' });
    docker.state = { ...payload(plan, 'exited'), Id: 'c'.repeat(64) };
    expect(await backend.inspect(plan, operation())).toEqual({ state: 'unknown', reason: 'conflict' });
    expect(await backend.dispatchStartOnce(plan, operation())).toEqual({ outcome: 'rejected', reason: 'start_fenced' });
    expect(docker.mutations().map(call => call.method)).toEqual(['DELETE']);
  });
});
