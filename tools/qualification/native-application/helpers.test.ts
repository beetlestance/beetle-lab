import {imageRevision,nativeArchitecture} from './compose/fixture.js';
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

const revisionImage=(revision:string)=>({Config:{Labels:{'org.opencontainers.image.revision':revision}}});
it('qualifies only a shared immutable revision and binds an explicit expected checkout',()=>{
 const revision='a'.repeat(40);const images=Array.from({length:6},()=>revisionImage(revision));
 expect(imageRevision(images)).toBe(revision);expect(imageRevision(images,revision)).toBe(revision);
 expect(()=>imageRevision(images,'b'.repeat(40))).toThrow();
});
it('rejects one mixed image even when the remaining revision labels match',()=>{
 const images=Array.from({length:6},()=>revisionImage('a'.repeat(40)));images[4]=revisionImage('b'.repeat(40));
 expect(()=>imageRevision(images)).toThrow();
});
it('refuses missing or mutable revision labels before creating qualification resources',()=>{
 for(const images of [[],[{Config:{}}],[revisionImage('local')],[revisionImage('A'.repeat(40))]])expect(()=>imageRevision(images)).toThrow();
});

it('normalizes Node x64 and Docker amd64 aliases for native CI runners',()=>{
 expect(nativeArchitecture('x86_64','x64','amd64')).toBe('amd64');
 expect(nativeArchitecture('amd64','x64','amd64')).toBe('amd64');
 expect(nativeArchitecture('aarch64','arm64','arm64')).toBe('arm64');
 expect(nativeArchitecture('arm64','arm64')).toBe('arm64');
});
it('rejects cross-architecture, unsupported or wrong-matrix qualification',()=>{
 expect(()=>nativeArchitecture('x86_64','arm64')).toThrow();
 expect(()=>nativeArchitecture('aarch64','x64')).toThrow();
 expect(()=>nativeArchitecture('arm64','arm64','amd64')).toThrow();
 expect(()=>nativeArchitecture('s390x','s390x')).toThrow();
});
