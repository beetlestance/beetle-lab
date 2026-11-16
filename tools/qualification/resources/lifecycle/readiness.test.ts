import {expect, it, vi} from 'vitest';
import capability from '../../../../contracts/fixtures/valid/capabilities.json' with {type: 'json'};
import type {Fixture} from '../../native-application/compose/fixture.js';
import {recoveredAgent} from './readiness.js';
const id = 'a'.repeat(64);
function peer(reply: unknown) {
  const docker = {json: vi.fn<(args: string[]) => unknown>(() => reply)};
  const compose = vi.fn(() => id);
  return {f: {docker, compose, home: '/owned/home'} as unknown as Fixture, docker, compose};
}
it('probes the healthy backend peer without injecting processes into the recovering agent', () => {
  const {f, docker, compose} = peer({status: 200, body: JSON.stringify(capability)});
  expect(recoveredAgent(f, capability.observation.installationId)).toEqual({ready: true, status: 200});
  expect(compose).toHaveBeenCalledExactlyOnceWith('ps', '-q', 'backend');
  expect(docker.json.mock.calls[0]?.[0].slice(0, 4)).toEqual(['exec', '--user', '1000:1000', id]);
});
it('rejects unavailable, malformed and foreign capability identities', () => {
  for (const reply of [{status: 503}, {status: 200, body: '{}'}, {status: 200, body: 'x'.repeat(65537)}]) {
    expect(recoveredAgent(peer(reply).f, capability.observation.installationId).ready).toBe(false);
  }
  expect(recoveredAgent(peer({status: 200, body: JSON.stringify(capability)}).f, 'different-installation').ready).toBe(false);
});
