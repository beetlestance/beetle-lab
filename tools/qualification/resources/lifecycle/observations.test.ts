import {describe, expect, it, vi} from 'vitest';
import type {Run} from '@beetle/contracts/api';
import type {Fixture} from '../../native-application/compose/fixture.js';
import {runtime, stopForCustody} from './observations.js';
import {crash} from './active.js';
import type {Client} from './active.js';
import {configuration, qualificationCases} from './configuration.js';
const id = 'a'.repeat(64); const image = 'sha256:' + 'b'.repeat(64);
const run = {activeAttemptId: 'attempt'} as Run;
function fake(labels: Record<string, string>, ids = id) {
  const row = {Id: id, Image: image, Config: {Labels: labels}, State: {Running: true}, RestartCount: 0,
    HostConfig: {Memory: 536870912, NanoCpus: 1000000000, PidsLimit: 128}};
  const docker = {run: vi.fn(() => ids), json: vi.fn<(...args: unknown[]) => unknown>(() => [row])};
  const f = {docker, project: 'owned', compose: vi.fn(() => id), imageIds: {engine: image, backend: image, agent: image}} as unknown as Fixture;
  return {f, docker, row};
}
describe('active recovery fault authority', () => {
  it('keeps cancellation in a fresh explicit profile without raising retained-output quotas', () => {
    expect(qualificationCases('crashes')).toEqual(['backend', 'agent']);
    expect(qualificationCases('cancel')).toEqual(['cancel']);
    expect(() => qualificationCases('all')).toThrow();
  });
  it('validates the finite synthetic fixture against the real schema before Docker effects', async () => {
    const config = await configuration();
    expect(config.target).toBe('http://target:8080');
  });
  it('binds exactly one original to attempt, installation and generation', () => {
    const {f} = fake({'dev.beetle.attempt': 'attempt', 'dev.beetle.installation': 'installation', 'dev.beetle.generation': '1'});
    expect(runtime(f, run, 'installation').id).toBe(id);
  });
  it('rejects ambiguous originals or foreign installation/generation', () => {
    const labels = {'dev.beetle.attempt': 'attempt', 'dev.beetle.installation': 'installation', 'dev.beetle.generation': '1'};
    for (const f of [fake(labels, id + '\n' + 'c'.repeat(64)).f,
      fake({...labels, 'dev.beetle.installation': 'foreign'}).f, fake({...labels, 'dev.beetle.generation': '2'}).f]) expect(() => runtime(f, run, 'installation')).toThrow();
  });
  it('rejects completed work during fault dispatch preparation', async () => {
    const {f, docker, row} = fake({'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'backend'});
    docker.json.mockReturnValueOnce([row]).mockReturnValueOnce({ready: 1, work: 40, unexpected: 0});
    await expect(crash(f, {} as Client, 'backend', 0)).rejects.toThrow('Work completed before acknowledged crash');
    expect(docker.run).toHaveBeenCalledExactlyOnceWith(['kill', '--signal', 'KILL', id]);
  });
  it('explicitly restarts only the same inspected service after acknowledged SIGKILL', async () => {
    const {f, docker, row} = fake({'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'backend'});
    docker.json.mockReturnValueOnce([{...row, State: {Running: true, StartedAt: 'before'}}])
      .mockReturnValueOnce({ready: 1, work: 8, unexpected: 0})
      .mockReturnValueOnce([{...row, State: {Running: false, ExitCode: 137, OOMKilled: false}}])
      .mockReturnValueOnce([{...row, State: {Running: true, StartedAt: 'after'}}])
      .mockReturnValueOnce({ready: 1, work: 10, unexpected: 0});
    const session = {synthetic: true};
    const client = {session, api: {getBrowserSession: async () => ({ok: true, value: session})}} as unknown as Client;
    expect(await crash(f, client, 'backend', 0)).toMatchObject({restart: 'explicit-same-service', progressAtAcknowledgedKill: 8});
    expect(docker.run.mock.calls).toEqual([[['kill', '--signal', 'KILL', id]], [['start', id]]]);
  });
  it('rejects work completed before recovered service readiness', async () => {
    const {f, docker, row} = fake({'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'backend'});
    docker.json.mockReturnValueOnce([{...row, State: {Running: true, StartedAt: 'before'}}])
      .mockReturnValueOnce({ready: 1, work: 8, unexpected: 0})
      .mockReturnValueOnce([{...row, State: {Running: false, ExitCode: 137, OOMKilled: false}}])
      .mockReturnValueOnce([{...row, State: {Running: true, StartedAt: 'after'}}])
      .mockReturnValueOnce({ready: 1, work: 40, unexpected: 0});
    const session = {synthetic: true};
    const client = {session, api: {getBrowserSession: async () => ({ok: true, value: session})}} as unknown as Client;
    await expect(crash(f, client, 'backend', 0)).rejects.toThrow('Original finished or reset before recovered service was ready');
  });
  it('refuses custody reads while the verified serving backend is still running', () => {
    const {f, docker, row} = fake({'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'backend'});
    expect(() => stopForCustody(f)).toThrow(); expect(docker.run).not.toHaveBeenCalled();
    row.State.Running = false; expect(() => stopForCustody(f)).not.toThrow();
    expect(docker.run).not.toHaveBeenCalled();
  });
  it('never sends a fault to a foreign Compose service or image', async () => {
    for (const labels of [{'com.docker.compose.project': 'foreign', 'com.docker.compose.service': 'backend'},
      {'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'agent'}]) {
      const {f, docker} = fake(labels);
      await expect(crash(f, {} as Client, 'backend', 0)).rejects.toThrow();
      expect(docker.run).not.toHaveBeenCalled();
    }
    const {f, docker, row} = fake({'com.docker.compose.project': 'owned', 'com.docker.compose.service': 'backend'});
    row.Image = 'sha256:' + 'd'.repeat(64);
    await expect(crash(f, {} as Client, 'backend', 0)).rejects.toThrow(); expect(docker.run).not.toHaveBeenCalled();
  });
});
