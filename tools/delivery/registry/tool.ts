import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {archiveProducer} from '../producer.js';
import {deliveryDigest} from '../files.js';
const toolDigests: Readonly<Record<string, string>> = {
  'darwin/arm64': '8ac077a1eeb834d3053714e86ccbd838d0da46567df8cd7c2695d1a19135bf60',
  'linux/x64': '3737fbbdd791e04e7a831640b681f3397a376498e80e2ad9b1b2d27296f239bc',
  'linux/arm64': '9f349bab5c407ac04f3dabf99c7c7a6b0f9e9723c23f2775380e804d02c6dbb9',
};
/** Pinned regctl v0.11.7; owned auth/config/call files never enter public plans. */
export class RegistryTool {
  private next = 0;
  private constructor(private readonly executable: string, private readonly directory: string) {}
  static async open(executable: string, directory: string, credentials?: {actor: string; token: string}): Promise<RegistryTool> {
    if (![executable, directory].every(path => isAbsolute(path) && path.length <= 4096)) throw Error('Absolute registry tool paths required');
    const expected = toolDigests[`${process.platform}/${process.arch}`];
    if (!expected || (await deliveryDigest(executable, 32 * 1024 ** 2)).sha256 !== expected) throw Error('Pinned registry tool digest mismatch');
    await mkdir(directory, {mode: 0o700}); const docker = join(directory, 'docker'); await mkdir(docker, {mode: 0o700});
    if (credentials) await RegistryTool.credentials(docker, credentials);
    process.env.REGCTL_CONFIG = join(directory, 'regctl.json'); process.env.DOCKER_CONFIG = docker;
    await writeFile(process.env.REGCTL_CONFIG, '{}', {flag: 'wx', mode: 0o600});
    return new RegistryTool(executable, directory);
  }
  private static async credentials(directory: string, input: {actor: string; token: string}): Promise<void> {
    if (!/^[A-Za-z0-9_.-]{1,80}(?:\[bot\])?$/.test(input.actor) || !input.token || input.token.length > 4096 || /[\r\n\0]/.test(input.token))
      throw Error('Invalid registry credential input');
    const auth = Buffer.from(`${input.actor}:${input.token}`).toString('base64');
    await writeFile(join(directory, 'config.json'), JSON.stringify({auths: {'ghcr.io': {auth}}}), {flag: 'wx', mode: 0o600});
  }
  async raw(args: readonly string[], allowEmptyOutput = false): Promise<Buffer> {
    if (args.length > 32 || args.some(value => value.length > 4096 || value.includes('\0'))) throw Error('Registry command argument bound');
    const output = join(this.directory, `call-${++this.next}.data`);
    await archiveProducer({executable: this.executable, args, destination: output, maximumBytes: 262144, allowEmptyOutput});
    return readFile(output); // Counted private leaf after original close.
  }
  async command(args: readonly string[]): Promise<void> {await this.raw(args, true);}
}
