import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { OUTPUT_READ_BYTES, OUTPUT_RESULT_BYTES } from './types.js';
import { OutputFailure } from './ports.js';
import type { OutputIO, OutputPorts } from './ports.js';

interface Entry { readonly path: string; readonly stat: BigIntStats; readonly directory: boolean }
interface OpenEntry extends Entry { readonly handle: FileHandle }
export interface OpenOutput { readonly chain: readonly OpenEntry[]; readonly file: OpenEntry }
function signature(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
function metadata(stat: BigIntStats, directory: boolean, uid: number): void {
  const kind = directory ? stat.isDirectory() : stat.isFile();
  if (!kind || stat.uid !== BigInt(uid) || (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)) {
    throw new OutputFailure('custody');
  }
  if (!directory && stat.nlink !== 1n) throw new OutputFailure('custody');
}
export class OutputFiles {
  private readonly entries = new Map<string, Entry>();
  private readonly identities = new Set<string>();
  private root: OpenEntry | undefined;
  constructor(private readonly options: { readonly directory: string; readonly uid: number },
    private readonly ports: OutputPorts, private readonly io: OutputIO) {}
  private async named(path: string, directory: boolean): Promise<BigIntStats> {
    const canonical = await this.io.io(() => this.ports.realpath(path));
    if (canonical !== path) throw new OutputFailure('custody');
    const stat = await this.io.io(() => this.ports.lstat(path, { bigint: true }));
    metadata(stat, directory, this.options.uid); return stat;
  }
  private async open(path: string, directory: boolean): Promise<OpenEntry> {
    const stat = await this.named(path, directory);
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0);
    const handle = await this.io.io(() => this.ports.open(path, flags).then(value => { this.io.own(value); return value; }));
    const actual = await this.io.io(() => handle.stat({ bigint: true }));
    metadata(actual, directory, this.options.uid);
    if (signature(actual) !== signature(stat)) throw new OutputFailure('custody');
    const before = this.entries.get(path);
    if (before && signature(before.stat) !== signature(stat)) throw new OutputFailure('custody');
    this.entries.set(path, { path, stat, directory });
    if (!directory) this.admitIdentity(stat);
    return { path, stat, directory, handle };
  }
  private admitIdentity(stat: BigIntStats): void {
    const identity = `${stat.dev}:${stat.ino}`;
    if (this.identities.has(identity)) throw new OutputFailure('custody');
    this.identities.add(identity);
  }
  async openOutput(relativePath: string): Promise<OpenOutput> {
    this.root ??= await this.open(this.options.directory, true);
    const chain: OpenEntry[] = [this.root]; const pieces = relativePath.split('/');
    let path = this.options.directory;
    for (const piece of pieces.slice(0, -1)) { path = join(path, piece); chain.push(await this.open(path, true)); }
    const file = await this.open(join(path, pieces[pieces.length - 1]!), false);
    const output = { chain, file }; await this.check(output); return output;
  }
  private async checkEntry(entry: OpenEntry): Promise<void> {
    const named = await this.named(entry.path, entry.directory);
    const actual = await this.io.io(() => entry.handle.stat({ bigint: true }));
    metadata(actual, entry.directory, this.options.uid);
    if (signature(named) !== signature(entry.stat) || signature(actual) !== signature(entry.stat)) throw new OutputFailure('custody');
  }
  async check(output: OpenOutput): Promise<void> {
    for (const entry of [...output.chain, output.file]) await this.checkEntry(entry);
  }
  async read(output: OpenOutput, buffer: Buffer, offset: number, position: number): Promise<number> {
    await this.check(output);
    const length = Math.min(OUTPUT_READ_BYTES, buffer.length - offset, Number(output.file.stat.size) - position);
    const { bytesRead } = await this.io.io(() => output.file.handle.read(buffer, offset, length, position));
    await this.check(output);
    if (bytesRead === 0) throw new OutputFailure('integrity');
    return bytesRead;
  }
  async readResult(output: OpenOutput): Promise<Buffer> {
    if (output.file.stat.size > BigInt(OUTPUT_RESULT_BYTES)) throw new OutputFailure('result');
    const buffer = Buffer.allocUnsafe(Number(output.file.stat.size)); let position = 0;
    while (position < buffer.length) position += await this.read(output, buffer, position, position);
    return buffer;
  }
  async closeOutput(output: OpenOutput): Promise<void> {
    await this.io.closeHandles([...output.chain.slice(1).map(entry => entry.handle), output.file.handle]);
  }
  async finalCheck(): Promise<void> {
    for (const entry of this.entries.values()) {
      const actual = await this.named(entry.path, entry.directory);
      if (signature(actual) !== signature(entry.stat)) throw new OutputFailure('custody');
    }
    if (this.root) await this.checkEntry(this.root);
  }
}
