import { EventEmitter } from 'node:events';
import type { ClientRequest, RequestOptions } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DockerBackend, TRANSPORT_LIMITS, UnixDockerTransport } from '../../../src/backends/docker/index.js';
import type { DockerReply, RequestFactory } from '../../../src/backends/docker/index.js';
import { FakeDocker, id, makeInput, makePlan, operation, payload } from './fixtures.js';

const stats = () => ({ id, cpu_stats: { cpu_usage: { total_usage: 12_345_678 } },
  memory_stats: { usage: 5000, stats: { inactive_file: 4000, cache: 4500 } }, pids_stats: { current: 3 } });
const ok = (body: unknown): DockerReply => ({ ok: true, status: 200, body });
async function fixture() {
  const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
  docker.state = payload(plan, 'running'); await backend.inspect(plan, operation());
  docker.intercept = request => request.path.includes('/stats?') ? ok(stats()) : undefined;
  return { plan, docker, backend };
}
describe('owned Docker stats', () => {
  it('uses exact inspected ID, raw memory, cumulative whole-ms CPU and actual PIDs', async () => {
    const { plan, docker, backend } = await fixture();
    expect(await backend.sampleResources(plan, operation())).toEqual({ cpuMillis: 12, memoryBytes: 5000, pids: 3, reason: null });
    expect(docker.calls.at(-1)).toMatchObject({ method: 'GET', path: `/v1.47/containers/${id}/stats?stream=false&one-shot=true` });
    expect(docker.calls.at(-1)!.deadline).toBeLessThanOrEqual(performance.now() + 1000);
    expect(docker.mutations()).toHaveLength(0);
  });
  it('refuses unknown, uninspected, created, exited and foreign plans without issuing stats', async () => {
    const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
    expect(await backend.sampleResources(plan, operation())).toMatchObject({ reason: 'invalid' });
    expect(docker.calls).toHaveLength(0);
    for (const state of ['created', 'exited']) {
      const own = new DockerBackend(docker); docker.state = payload(plan, state); await own.inspect(plan, operation());
      expect(await own.sampleResources(plan, operation())).toMatchObject({ reason: 'unavailable' });
    }
    const owned = await fixture(); const input = makeInput(); input.offer.budget.memoryBytes++;
    const other = makePlan({ ...input, profile: { ...input.profile, maximumBudget: { ...input.profile.maximumBudget, memoryBytes: input.offer.budget.memoryBytes } } });
    expect(await owned.backend.sampleResources(other, operation())).toMatchObject({ reason: 'invalid' });
    expect(owned.docker.calls.some(request => request.path.includes('/stats?'))).toBe(false);
  });
  it.each([
    { id: 'c'.repeat(64) }, { id: id.slice(0, 12) }, { cpu_stats: { cpu_usage: { total_usage: Number.MAX_SAFE_INTEGER + 1 } } },
    { cpu_stats: { cpu_usage: { total_usage: -1 } } }, { memory_stats: { usage: '0' } },
    { pids_stats: { current: 1.5 } }, { cpu_stats: 'bad' }, { memory_stats: [] },
  ])('rejects unsafe, malformed or wrong-ID reply %j', async changed => {
    const { plan, docker, backend } = await fixture(); docker.intercept = request => request.path.includes('/stats?') ? ok({ ...stats(), ...changed }) : undefined;
    expect(await backend.sampleResources(plan, operation())).toEqual({ cpuMillis: null, memoryBytes: null, pids: null, reason: 'invalid' });
  });
  it('retains missing fields as unknown and distinguishes measured zeros', async () => {
    const { plan, docker, backend } = await fixture();
    docker.intercept = request => request.path.includes('/stats?') ? ok({ id, memory_stats: { usage: 0 } }) : undefined;
    expect(await backend.sampleResources(plan, operation())).toEqual({ cpuMillis: null, memoryBytes: 0, pids: null, reason: 'unsupported' });
    docker.intercept = request => request.path.includes('/stats?') ? ok({ id, cpu_stats: { cpu_usage: { total_usage: 0 } }, memory_stats: { usage: 0 }, pids_stats: { current: 0 } }) : undefined;
    expect(await backend.sampleResources(plan, operation())).toEqual({ cpuMillis: 0, memoryBytes: 0, pids: 0, reason: null });
  });
  it('detects a raw CPU counter reset even when both readings round to the same millisecond', async () => {
    const { plan, docker, backend } = await fixture();
    let ns = 1_999_999;
    docker.intercept = request => request.path.includes('/stats?')
      ? ok({ ...stats(), cpu_stats: { cpu_usage: { total_usage: ns } } }) : undefined;
    expect(await backend.sampleResources(plan, operation())).toMatchObject({ cpuMillis: 1, reason: null });
    ns = 1_000_001;
    expect(await backend.sampleResources(plan, operation())).toMatchObject({ cpuMillis: null, reason: 'counter_reset' });
    ns = 2_000_000;
    expect(await backend.sampleResources(plan, operation())).toMatchObject({ cpuMillis: 2, reason: null });
  });
  it('does not hold the mutation lane, revoke ownership, or accept a late post-stop reading', async () => {
    const { plan, docker, backend } = await fixture(); let complete!: (reply: DockerReply) => void;
    const held = new Promise<DockerReply>(resolve => { complete = resolve; });
    docker.intercept = request => request.path.includes('/stats?') ? held : undefined;
    const read = backend.sampleResources(plan, operation());
    expect(await backend.kill(plan, operation())).toMatchObject({ outcome: 'known', value: { id, state: 'exited' } });
    complete(ok(stats())); expect(await read).toMatchObject({ reason: 'unavailable', cpuMillis: null });
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'exited' });
  });
  it('checks abort and deadline after originals that ignore cancellation', async () => {
    const { plan, docker, backend } = await fixture(); let complete!: (reply: DockerReply) => void;
    const abort = new AbortController();
    docker.intercept = request => request.path.includes('/stats?') ? new Promise(resolve => { complete = resolve; }) : undefined;
    const read = backend.sampleResources(plan, { ...operation(), signal: abort.signal }); abort.abort();
    let settled = false; void read.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    complete(ok(stats())); expect(await read).toMatchObject({ reason: 'unavailable' });
    expect(await backend.inspect(plan, operation())).toMatchObject({ id, state: 'running' });
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const late = backend.sampleResources(plan, { deadline: 50 }); now.mockReturnValue(51); complete(ok(stats()));
      expect(await late).toMatchObject({ reason: 'unavailable', cpuMillis: null });
    } finally { now.mockRestore(); }
  });
});

class Request extends EventEmitter {
  constructor(readonly input: RequestOptions, private readonly respond: (request: Request) => void) { super(); }
  destroyed = false;
  end(): void { queueMicrotask(() => this.respond(this)); }
  destroy(): void { if(this.destroyed)return;this.destroyed = true;queueMicrotask(()=>this.emit('close')); }
  reply(body: string): void {
    const incoming = Object.assign(new PassThrough(), { statusCode: 200, complete: true });
    this.emit('response', incoming); incoming.end(body);
  }
}
it('reads actual bounded Unix transport JSON and rejects overflow/malformed stats', async () => {
  const plan = makePlan(); const requests: Request[] = []; const docker = new FakeDocker(plan); docker.state = payload(plan, 'running');
  let body = JSON.stringify(stats());
  const factory = ((input: RequestOptions) => {
    const request = new Request(input, request => {
      const path = String(request.input.path);
      const reply = docker.respond({ method: 'GET', path, deadline: performance.now() + 1000 });
      request.reply(path.includes('/stats?') ? body : JSON.stringify(reply.ok ? reply.body : null));
    }); requests.push(request); return request as unknown as ClientRequest;
  }) as RequestFactory;
  const backend = new DockerBackend(new UnixDockerTransport('/tmp/w304-resource-fixture.sock', factory));
  await backend.inspect(plan, operation());
  expect(await backend.sampleResources(plan, operation())).toMatchObject({ cpuMillis: 12, memoryBytes: 5000 });
  body = 'x'.repeat(TRANSPORT_LIMITS.responseBytes + 1);
  expect(await backend.sampleResources(plan, operation())).toMatchObject({ reason: 'unavailable', cpuMillis: null });
  body = '{'; expect(await backend.sampleResources(plan, operation())).toMatchObject({ reason: 'invalid' });
  expect(requests.every(request => request.destroyed)).toBe(true);
  expect(requests.at(-1)!.input).toMatchObject({ socketPath: '/tmp/w304-resource-fixture.sock', method: 'GET' });
});
