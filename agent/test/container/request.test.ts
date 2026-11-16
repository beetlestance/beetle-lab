import {expect, it, vi} from 'vitest';
import {request} from './docker.js';
import type {Docker} from './docker.js';

function fixture() {
  const run = vi.fn<Docker['run']>(() => JSON.stringify({status: 200, body: '{}'}));
  return {run, docker: {run} as unknown as Docker};
}
const input = {agent: 'synthetic-agent', credentialFile: '/private/synthetic-token', path: '/runner/v1/capabilities'};
it('runs a credential-reading probe with the explicit dropped service identity', () => {
  const f = fixture(); expect(request(f.docker, {...input, user: '1000:1000'}).status).toBe(200);
  expect(f.run.mock.calls[0]![0].slice(0, 6)).toEqual(['exec', '-i', '--user', '1000:1000', 'synthetic-agent', 'node']);
});
it('preserves the image default when a qualification profile does not override identity', () => {
  const f = fixture(); request(f.docker, input);
  expect(f.run.mock.calls[0]![0].slice(0, 4)).toEqual(['exec', '-i', 'synthetic-agent', 'node']);
});
it.each(['0:0', '1000:0', '--privileged', 'root', '1000:1000\n', '1:2:3'])('rejects invalid probe identity %j before a Docker call', user => {
  const f = fixture(); expect(() => request(f.docker, {...input, user})).toThrow('Invalid qualification request identity');
  expect(f.run).not.toHaveBeenCalled();
});
