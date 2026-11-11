import { expect, it } from 'vitest';
import type { DockerReply } from '../../../src/backends/docker/index.js';
import { DockerBackend } from '../../../src/backends/docker/index.js';
import { inspectEvidence } from '../../../src/backends/docker/inspect.js';
import { liveFixture } from './mailbox-volume-fixtures.js';
import { operation, payload, unavailable } from './fixtures.js';
const evidence = {sealed: true, applicationAcknowledged: true} as const;
it('creates one exact local tmpfs volume before container creation and guards normal removal', async () => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('known');
  const mutations = docker.mutations(); expect(mutations).toHaveLength(2);
  expect(mutations[0]?.path).toBe('/v1.47/volumes/create');
  expect(mutations[0]?.body).toEqual({Name: `${plan.name}-live`, Driver: 'local',
    DriverOpts: {type: 'tmpfs', device: 'tmpfs', o: 'rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=10001,gid=10001,mode=0700'},
    Labels: {...plan.spec.Labels, 'dev.beetle.purpose': 'live-mailbox'}});
  expect((await backend.dispatchStartOnce(plan, operation())).outcome).toBe('known');
  expect((await backend.remove(plan, operation(), evidence)).outcome).toBe('rejected');
  expect((await backend.stop(plan, operation(), 0)).outcome).toBe('known');
  expect(await backend.remove(plan, operation(), evidence)).toEqual({outcome: 'known', value: 'removed'});
  expect(docker.volume).toBeUndefined(); expect(docker.state).toBeUndefined();
  expect(docker.mutations().at(-1)?.path).toBe(`/v1.47/volumes/${plan.name}-live?force=false`);
});
it('adopts a lost volume-create reply by inspection without repeating creation', async () => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  docker.intercept = input => {
    if (input.path !== '/v1.47/volumes/create') return undefined;
    docker.respond(input); docker.intercept = undefined; return unavailable();
  };
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('unknown');
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('known');
  expect(docker.calls.filter(call => call.path === '/v1.47/volumes/create')).toHaveLength(1);
});
it('does not repeat volume creation when a lost reply still has no proven volume', async () => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  docker.intercept = input => input.path === '/v1.47/volumes/create' ? unavailable() : undefined;
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('unknown');
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('unknown');
  expect(docker.mutations()).toHaveLength(1);
});
it('refuses a pre-existing volume even with matching labels when no container owns it', async () => {
  const {plan, docker} = liveFixture();
  const first = new DockerBackend(docker); await first.ensureCreated(plan, operation()); docker.state = undefined;
  const before = docker.mutations().length;
  expect((await new DockerBackend(docker).ensureCreated(plan, operation())).outcome).toBe('rejected');
  expect(docker.mutations()).toHaveLength(before);
});
it.each(['Driver', 'Scope', 'Options', 'Labels'])('refuses mismatched volume %s before start or deletion', async field => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  await backend.ensureCreated(plan, operation()); docker.volume![field] = field === 'Labels' ? {} : 'foreign';
  const before = docker.mutations().length;
  expect((await backend.dispatchStartOnce(plan, operation())).outcome).toBe('unknown');
  expect((await backend.remove(plan, operation(), evidence)).outcome).toBe('rejected');
  expect(docker.mutations()).toHaveLength(before);
});
it('recovers an existing matching container/volume and reconciles lost delete without repeating it', async () => {
  const {plan, docker} = liveFixture(); await new DockerBackend(docker).ensureCreated(plan, operation());
  const backend = new DockerBackend(docker);
  expect((await backend.inspect(plan, operation())).state).toBe('created');
  docker.intercept = input => {
    if (input.method !== 'DELETE' || !input.path.startsWith('/v1.47/volumes/')) return undefined;
    docker.respond(input); docker.intercept = undefined; return unavailable();
  };
  expect((await backend.remove(plan, operation(), evidence)).outcome).toBe('unknown');
  expect(await backend.remove(plan, operation(), evidence)).toEqual({outcome: 'known', value: 'removed'});
  expect(docker.calls.filter(call => call.method === 'DELETE' && call.path.startsWith('/v1.47/volumes/'))).toHaveLength(1);
});
it('requires the exact local volume mount and no-copy request in container inspection', () => {
  const {plan} = liveFixture(); const actual = payload(plan);
  expect(inspectEvidence(actual, plan).ok).toBe(true);
  const summary = (actual.Mounts as Record<string, unknown>[]).at(-1)!; summary.Driver = 'other';
  expect(inspectEvidence(actual, plan).ok).toBe(false);
  const changed = payload(plan); const host = changed.HostConfig as {Mounts: Record<string, unknown>[]};
  host.Mounts.at(-1)!.VolumeOptions = {NoCopy: false}; expect(inspectEvidence(changed, plan).ok).toBe(false);
});

it.each([
  {label: 'undispatched failure', reply: {ok: false, reason: 'unavailable', dispatched: false}, retained: false},
  {label: 'definite rejection', reply: {ok: true, status: 400, body: null}, retained: false},
  {label: 'dispatched unknown', reply: {ok: false, reason: 'unavailable', dispatched: true}, retained: true},
] as const)('cleans only settled container-create failures: $label', async ({reply, retained}) => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  docker.intercept = input => input.path.startsWith('/v1.47/containers/create') ? reply as DockerReply : undefined;
  await backend.ensureCreated(plan, operation());
  const removed = await backend.remove(plan, operation(), evidence);
  expect(removed.outcome).toBe(retained ? 'rejected' : 'known');
  expect(docker.volume !== undefined).toBe(retained);
  const count = docker.mutations().length;
  expect((await backend.ensureCreated(plan, operation())).outcome).not.toBe('known');
  expect(docker.mutations()).toHaveLength(count);
});
it.each(['stop', 'kill'] as const)('keeps %s available when volume verification fails after start', async action => {
  const {plan, docker} = liveFixture(); const backend = new DockerBackend(docker);
  await backend.ensureCreated(plan, operation()); await backend.dispatchStartOnce(plan, operation());
  docker.intercept = input => input.path.startsWith('/v1.47/volumes/') ? unavailable() : undefined;
  expect((await backend.inspect(plan, operation())).state).toBe('unknown');
  expect((await backend.readMailbox(plan, operation())).ok).toBe(false);
  const stopped = action === 'kill' ? await backend.kill(plan, operation()) : await backend.stop(plan, operation(), 0);
  expect(stopped.outcome).toBe('known');
  expect(docker.calls.some(call => call.path.includes(action === 'kill' ? '/kill?signal=SIGKILL' : '/stop?t='))).toBe(true);
  expect((await backend.remove(plan, operation(), evidence)).outcome).toBe('rejected');
  expect(docker.volume).toBeDefined();
});
