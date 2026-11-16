import {describe, expect, it} from 'vitest';
import {DockerBackend} from '../../../src/backends/docker/index.js';
import type {DockerReply} from '../../../src/backends/docker/index.js';
import {resourceReading} from '../../../src/backends/docker/resources.js';
import type {StatsRequestBinding} from '../../../src/backends/docker/resources.js';
import {FakeDocker, id, makePlan, operation, payload} from './fixtures.js';
const path = `/v1.47/containers/${id}/stats?stream=false&one-shot=true`;
const binding: StatsRequestBinding = Object.freeze({id, method: 'GET', path});
const legacy = () => ({cpu_stats: {cpu_usage: {total_usage: 12345678}}, memory_stats: {usage: 5000}, pids_stats: {current: 3}});
const ok = (body: unknown): DockerReply => ({ok: true, status: 200, body});
async function fixture() {
  const plan = makePlan(); const docker = new FakeDocker(plan); const backend = new DockerBackend(docker);
  docker.state = payload(plan, 'running'); await backend.inspect(plan, operation());
  return {plan, docker, backend};
}
describe('request-bound native stats identity', () => {
  it('accepts an omitted body ID only under the exact full-ID GET binding', () => {
    expect(resourceReading(ok(legacy()), binding, {cpuNs: null})).toEqual({cpuMillis: 12, memoryBytes: 5000, pids: 3, reason: null});
    for (const changed of [{...binding, id: id.slice(0, 12)}, {...binding, method: 'POST' as const},
      {...binding, path: `/v1.47/containers/${id}/json`}, {...binding, path: path.replace('stream=false', 'stream=true')},
      {...binding, path: path.replace(id, 'c'.repeat(64))}]) {
      const previous = {cpuNs: 100}; expect(resourceReading(ok(legacy()), changed, previous).reason).toBe('invalid'); expect(previous.cpuNs).toBe(100);
    }
  });
  it.each([null, undefined, '', id.slice(0, 12), 'c'.repeat(64), 42])('rejects every present invalid ID without altering CPU history: %j', invalid => {
    const previous = {cpuNs: 100};
    expect(resourceReading(ok({...legacy(), id: invalid}), binding, previous)).toEqual({cpuMillis: null, memoryBytes: null, pids: null, reason: 'invalid'});
    expect(previous.cpuNs).toBe(100);
  });
  it('captures the exact immutable request before awaiting a legacy reply', async () => {
    const {plan, docker, backend} = await fixture();
    docker.intercept = input => {
      if (!input.path.includes('/stats?')) return undefined;
      expect(input.method).toBe('GET'); expect(input.path).toBe(path); expect(Object.isFrozen(input)).toBe(true);
      expect(Reflect.set(input, 'path', '/v1.47/containers/foreign/stats')).toBe(false);
      return ok(legacy());
    };
    expect(await backend.sampleResources(plan, operation())).toEqual({cpuMillis: 12, memoryBytes: 5000, pids: 3, reason: null});
  });
  it('rechecks runtime ownership before consuming an ID-less response', async () => {
    const {plan, docker, backend} = await fixture(); let finish!: (reply: DockerReply) => void;
    docker.intercept = input => input.path.includes('/stats?') ? new Promise(resolve => {finish = resolve;}) : undefined;
    const pending = backend.sampleResources(plan, operation());
    expect(await backend.kill(plan, operation())).toMatchObject({outcome: 'known', value: {state: 'exited'}});
    finish(ok(legacy())); expect(await pending).toEqual({cpuMillis: null, memoryBytes: null, pids: null, reason: 'unavailable'});
  });
});
