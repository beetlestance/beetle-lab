import { expect, it } from 'vitest';
import { argumentsFor, agentOrigin } from './configuration.js';
import { retainedCharge } from './evidence.js';

it('accepts explicit local image/context arguments and rejects extra or malformed controls', () => {
  expect(argumentsFor(['agent:local', `sha256:${'a'.repeat(64)}`])).toEqual({
    agentImage: 'agent:local', engineImage: `sha256:${'a'.repeat(64)}`, status: 200, context: 'default' });
  expect(argumentsFor(['agent:local', 'engine:local', '500', 'desktop-linux']).status).toBe(500);
  for (const args of [[], ['agent'], ['a', 'e', '503'], ['a', 'e', '200', 'default', 'extra'],
    ['--privileged', 'e'], ['a', 'e', '200', 'tcp://host'], ['a\nevil', 'e'], ['a'.repeat(257), 'e']]) {
    expect(() => argumentsFor(args)).toThrow();
  }
});
it('only accepts one dynamically published loopback port', () => {
  expect(agentOrigin('127.0.0.1:49152')).toBe('http://127.0.0.1:49152');
  for (const port of ['0.0.0.0:4312', '[::]:4312', '127.0.0.1:0', '127.0.0.1:65536',
    '127.0.0.1:4312\n127.0.0.1:4313', '127.0.0.1:04312']) expect(() => agentOrigin(port)).toThrow();
});
it('independently accounts retained event/manifest/artifact payload and preserves metadata', () => {
  expect(retainedCharge(1024, 2048, 4096, 16384)).toEqual({ retained: 7168, refunded: 9216, charged: 72704 });
  expect(retainedCharge(0, 0, 0, 1)).toEqual({ retained: 0, refunded: 1, charged: 65536 });
  for (const input of [[-1, 0, 0, 1], [1.5, 0, 0, 2], [1, 1, 1, 2], [NaN, 0, 0, 2],
    [Number.MAX_SAFE_INTEGER, 1, 0, Number.MAX_SAFE_INTEGER], [0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    expect(() => retainedCharge(input[0]!, input[1]!, input[2]!, input[3]!)).toThrow();
  }
});
