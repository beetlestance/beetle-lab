import {expect, it} from 'vitest';
import {verifyPrivateStore} from './private-store.js';
function fixture() {
  const info = {DockerRootDir: '/synthetic/store', Driver: 'vfs', OSType: 'linux', Architecture: 'aarch64'};
  let images = ''; let containers = '';
  const command = (args: readonly string[]) => Buffer.from(args[0] === 'info' ? JSON.stringify(info) : args[0] === 'image' ? images : containers);
  return {info, command, images: (value: string) => {images = value;}, containers: (value: string) => {containers = value;}};
}
it('requires an empty private native VFS daemon at the exact owned data root', () => {
  const expected = {root: '/synthetic/store', architecture: 'arm64' as const}; const f = fixture();
  expect(() => verifyPrivateStore(f.command, expected)).not.toThrow();
  f.images('sha256:synthetic'); expect(() => verifyPrivateStore(f.command, expected)).toThrow('not empty'); f.images('');
  f.containers('synthetic'); expect(() => verifyPrivateStore(f.command, expected)).toThrow('not empty'); f.containers('');
  f.info.DockerRootDir = '/other/store'; expect(() => verifyPrivateStore(f.command, expected)).toThrow('Wrong private');
  f.info.DockerRootDir = expected.root; f.info.Driver = 'overlayfs'; expect(() => verifyPrivateStore(f.command, expected)).toThrow('Wrong private');
  f.info.Driver = 'vfs'; f.info.Architecture = 'x86_64'; expect(() => verifyPrivateStore(f.command, expected)).toThrow('Wrong private');
});
