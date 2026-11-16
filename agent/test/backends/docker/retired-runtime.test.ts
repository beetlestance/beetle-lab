import { expect, it } from 'vitest';
import { DockerBackend } from '../../../src/backends/docker/index.js';
import { id, makePlan, operation, payload, unavailable } from './fixtures.js';
import { liveFixture } from './mailbox-volume-fixtures.js';
import { daemonId, RetiredDocker,associationFixture } from './retired-fixtures.js';
const binding = { runtimeId: id, daemonId };
it.each(['created', 'exited'] as const)('binds original ID before observing %s, removes only that ID without force/volumes and confirms exact absence', async state => {
  const plan = makePlan(); const docker = new RetiredDocker(plan); docker.state = payload(plan, state);
  const backend = new DockerBackend(docker);
  expect(await backend.removeRetired(plan, operation(), binding)).toEqual({ outcome: 'known', value: 'removed' });
  expect(docker.mutations().map(input => input.path)).toEqual([`/v1.47/containers/${id}?force=false&v=false`]);
  expect(docker.calls.some(input => input.path === `/v1.47/containers/${id}/json`)).toBe(true);
  expect(docker.calls.at(-1)?.path).toBe(`/v1.47/containers/${plan.name}/json`);
  expect((await backend.ensureCreated(plan, operation())).outcome).toBe('rejected');
  expect((await backend.dispatchStartOnce(plan, operation())).outcome).toBe('rejected');
});
it('refuses a same-name/full-spec replacement or a renamed original before deletion', async () => {
  for (const mode of ['replacement', 'renamed'] as const) {
    const plan = makePlan(); const docker = new RetiredDocker(plan); docker.state = payload(plan, 'exited');
    if (mode === 'replacement') docker.state.Id = 'f'.repeat(64); else docker.state.Name = '/user-renamed-original';
    expect((await new DockerBackend(docker).removeRetired(plan, operation(), binding)).outcome).not.toBe('known');
    expect(docker.mutations()).toHaveLength(0);
  }
});
it('refuses an unexpected daemon before any container observation or deletion', async () => {
  const plan = makePlan(); const docker = new RetiredDocker(plan); docker.state = payload(plan, 'exited');
  expect(await new DockerBackend(docker).removeRetired(plan, operation(), { ...binding, daemonId: 'foreign-daemon' }))
    .toEqual({ outcome: 'rejected', reason: 'conflict' });
  expect(docker.calls.every(input => input.path === '/version' || input.path === '/v1.47/info')).toBe(true);
});
it('accepts exact original and name absence without inventing local create/delete history', async () => {
  const plan = makePlan(); const docker = new RetiredDocker(plan); const backend = new DockerBackend(docker);
  expect(await backend.removeRetired(plan, operation(), binding)).toEqual({ outcome: 'known', value: 'removed' });
  expect(docker.mutations()).toHaveLength(0);
  const entries = Reflect.get(backend, 'entries') as Map<string, { createClaimed: boolean; creationSettled: boolean; removalClaimed: boolean }>;
  expect(entries.get(plan.name)).toMatchObject({ createClaimed: false, creationSettled: false, removalClaimed: false });
});
it('requires verified mailbox association and refuses cold existing-volume adoption when the original is already absent', async () => {
  const { plan } = liveFixture(); const docker = new RetiredDocker(plan); const initial = new DockerBackend(docker);
  expect((await initial.ensureCreated(plan, operation())).outcome).toBe('known'); docker.state = undefined; docker.calls.length = 0;
  const cold = new DockerBackend(docker); expect(await cold.removeRetired(plan, operation(), binding))
    .toEqual({ outcome: 'rejected', reason: 'cleanup_guard' });
  expect(docker.mutations()).toHaveLength(0); expect(docker.volume).toBeDefined();
});
it('uses a genuinely matched original container to verify association, then removes and confirms its mailbox non-force', async () => {
  const { plan } = liveFixture(); const docker = new RetiredDocker(plan); const initial = new DockerBackend(docker);
  await initial.ensureCreated(plan, operation()); docker.state = payload(plan, 'exited'); docker.calls.length = 0;
  expect(await new DockerBackend(docker).removeRetired(plan, operation(), binding,associationFixture())).toEqual({ outcome: 'known', value: 'removed' });
  expect(docker.mutations().map(input => input.path)).toEqual([
    `/v1.47/containers/${id}?force=false&v=false`, `/v1.47/volumes/${plan.name}-live?force=false`]);
  expect(docker.volume).toBeUndefined();
});
it('keeps unknown DELETE explicit; only the retained verified association can reconcile the committed removal', async () => {
  const { plan } = liveFixture(); const docker = new RetiredDocker(plan); const initial = new DockerBackend(docker);
  await initial.ensureCreated(plan, operation()); docker.state = payload(plan, 'exited'); const backend = new DockerBackend(docker);const associations=associationFixture();
  docker.intercept = input => {
    if (input.method === 'DELETE' && input.path.startsWith('/v1.47/containers/')) { docker.state = undefined; return unavailable(); }
    return undefined;
  };
  expect((await backend.removeRetired(plan, operation(), binding,associations)).outcome).toBe('unknown'); docker.intercept = undefined;
  expect((await new DockerBackend(docker).removeRetired(plan, operation(), binding)).outcome).not.toBe('known');
  expect(await backend.removeRetired(plan, operation(), binding,associations)).toEqual({ outcome: 'known', value: 'removed' });
});
it.each(['running', 'restarting', 'paused', 'unknown'])('refuses %s without force, stop, create or delete effects', async state => {
  const plan = makePlan(); const docker = new RetiredDocker(plan); docker.state = payload(plan, state);
  expect((await new DockerBackend(docker).removeRetired(plan, operation(), binding)).outcome).not.toBe('known');
  expect(docker.mutations()).toHaveLength(0);
});
it('rejects malformed binding before any daemon/observation request', async () => {
  const plan = makePlan(); const docker = new RetiredDocker(plan); const backend = new DockerBackend(docker);
  expect((await backend.removeRetired(plan, operation(), { ...binding, runtimeId: 'not-original' })).outcome).toBe('rejected');
  expect(docker.calls).toHaveLength(0);
});
