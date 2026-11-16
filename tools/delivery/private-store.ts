import {execFileSync} from 'node:child_process';
import type {DockerCommand} from './references.js';
import type {Architecture} from './identity.js';
export function privateDocker(socket: string, config: string): DockerCommand {
  return args => execFileSync('docker', ['--host', socket, '--config', config, ...args],
    {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe']});
}
export function verifyPrivateStore(command: DockerCommand, expected: {root: string; architecture: Architecture}): void {
  const info = JSON.parse(command(['info', '--format', '{{json .}}']).toString('utf8')) as Record<string, unknown>;
  const arch = info.Architecture === 'aarch64' ? 'arm64' : info.Architecture === 'x86_64' ? 'amd64' : info.Architecture;
  if (info.DockerRootDir !== expected.root || info.Driver !== 'vfs' || info.OSType !== 'linux' || arch !== expected.architecture)
    throw Error('Wrong private qualification daemon');
  if (command(['image', 'ls', '--all', '--quiet']).length || command(['ps', '--all', '--quiet']).length) throw Error('Qualification store was not empty');
}
