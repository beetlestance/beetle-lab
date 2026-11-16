import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Budget } from './budget.js';
import { InputError } from './types.js';

interface Directory { readonly path: string; readonly dev: number; readonly ino: number }
/** Sequential IO; at most one file descriptor or bounded directory iterator is issued. */
export class Files {
  private readonly roots = new Map<string, Directory>();
  private readonly handles = new Map<FileHandle, Promise<void> | undefined>();
  constructor(private readonly budget: Budget, private readonly uid: number) {}
  async root(path: string): Promise<void> {
    if (!isAbsolute(path) || !Number.isSafeInteger(this.uid) || this.uid < 0) throw new InputError('filesystem');
    const canonical = await this.budget.wait(() => realpath(path));
    if (canonical !== path) throw new InputError('filesystem');
    const stat = await this.budget.wait(() => lstat(path));
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== this.uid) throw new InputError('filesystem');
    this.roots.set(path, { path, dev: stat.dev, ino: stat.ino });
  }
  private async parent(path: string): Promise<void> {
    const expected = this.roots.get(path);
    if (!expected) throw new InputError('filesystem');
    const stat = await this.budget.wait(() => lstat(path));
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== this.uid
      || stat.dev !== expected.dev || stat.ino !== expected.ino
      || await this.budget.wait(() => realpath(path)) !== path) throw new InputError('filesystem');
  }
  private regular(stat: Stats, limit: number): void {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== this.uid
      || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > limit) throw new InputError('filesystem');
  }
  async stat(root: string, name: string, limit: number): Promise<number> {
    await this.parent(root);
    const stat = await this.budget.wait(() => lstat(join(root, name)));
    this.regular(stat, limit); return stat.size;
  }
  async entries(root: string, expected: readonly string[]): Promise<void> {
    await this.parent(root);
    const directory = await this.budget.wait(() => opendir(root, { bufferSize: 1 }).then(dir => {
      this.directory = dir; this.directoryClose = undefined; return dir;
    }));
    const remaining = new Set(expected);
    for (let index = 0; index <= expected.length; index++) {
      const item = await this.budget.wait(() => directory.read());
      if (!item) {
        if (remaining.size) throw new InputError('binding');
        await this.budget.wait(() => this.closeDirectory()); return;
      }
      if (!remaining.delete(item.name)) throw new InputError('binding');
    }
    throw new InputError('binding');
  }
  private directory: Awaited<ReturnType<typeof opendir>> | undefined;
  private directoryClose: Promise<void> | undefined;
  private closeDirectory(): Promise<void> {
    this.directoryClose ??= Promise.resolve().then(() => this.directory!.close()).then(() => { this.directory = undefined; });
    return this.directoryClose;
  }
  async read(root: string, name: string, maximum: number): Promise<Uint8Array> {
    await this.parent(root);
    const path = join(root, name);
    const before = await this.budget.wait(() => lstat(path)); this.regular(before, maximum);
    const handle = await this.budget.wait(() => open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(fd => {
      this.handles.set(fd, undefined); return fd;
    }));
    const stat = await this.budget.wait(() => handle.stat()); this.regular(stat, maximum);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) throw new InputError('filesystem');
    const bytes = await this.content(handle, stat.size);
    await this.verifyRead({ handle, root, path, stat, maximum });
    await this.budget.wait(() => this.closeHandle(handle));
    return bytes;
  }
  private async content(handle: FileHandle, expectedSize: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(expectedSize);
    let size = 0;
    while (size < bytes.length) {
      const count = Math.min(65_536, bytes.length - size);
      const next = await this.budget.wait(() => handle.read(bytes, size, count, size));
      if (next.bytesRead < 1) throw new InputError('input_integrity');
      size += next.bytesRead;
    }
    const extra = new Uint8Array(1);
    if ((await this.budget.wait(() => handle.read(extra, 0, 1, size))).bytesRead !== 0) throw new InputError('input_limit');
    return bytes;
  }
  private async verifyRead(input: { handle: FileHandle; root: string; path: string; stat: Stats; maximum: number }): Promise<void> {
    const { handle, root, path, stat, maximum } = input;
    const after = await this.budget.wait(() => handle.stat()); this.regular(after, maximum);
    if (after.size !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino) throw new InputError('input_integrity');
    await this.parent(root);
    const named = await this.budget.wait(() => lstat(path)); this.regular(named, maximum);
    if (named.dev !== stat.dev || named.ino !== stat.ino || named.size !== stat.size) throw new InputError('filesystem');
  }
  private closeHandle(handle: FileHandle): Promise<void> {
    const previous = this.handles.get(handle);
    if (previous) return previous;
    const closing = Promise.resolve().then(() => handle.close()).then(() => { this.handles.delete(handle); });
    this.handles.set(handle, closing); return closing;
  }
  async close(): Promise<void> {
    const outcomes = await Promise.allSettled([
      ...(this.directory ? [this.closeDirectory()] : []),
      ...Array.from(this.handles.keys(), handle => this.closeHandle(handle)),
    ]);
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new InputError('filesystem');
  }
}
