import { lstat, opendir } from 'node:fs/promises';
import type { RecoveryEntry } from '@beetle/contracts/recovery';
import { recoveryCaps } from '@beetle/contracts/recovery';
import type { RecoveryIO } from './io.js';
import type { RecoveryLimits } from './types.js';
import { RecoveryError, limits } from './types.js';
import { child, copyFile, createDirectory, directory, stable } from './files.js';
import { copyDatabase } from './database.js';
/** Only selected published trees; never follows links or discovers arbitrary config roots. */
export class SnapshotTree {
  private readonly entries: RecoveryEntry[] = [];
  private readonly names = new Set<string>();
  private readonly planned = new Set<string>();
  private bytes = 0; private paths = 0;
  readonly bounds: RecoveryLimits;
  constructor(private readonly io: RecoveryIO, private readonly destination: string, bounds: RecoveryLimits) {this.bounds = limits(bounds);}
  private reserve(path: string): void {
    child(this.destination, path); if (this.planned.has(path)) return;
    if (this.planned.size >= this.bounds.maximumEntries || this.paths + path.length > recoveryCaps.pathBytes) throw new RecoveryError('limit');
    this.paths += path.length; this.planned.add(path);
  }
  private claim(path: string): void {
    if (this.names.has(path)) throw new RecoveryError('conflict');
    this.reserve(path); this.names.add(path);
  }
  async folder(path: string): Promise<void> {
    if (this.names.has(path)) return;
    const parent = path.split('/').slice(0, -1).join('/'); if (parent) await this.folder(parent);
    this.claim(path); await createDirectory(this.io, child(this.destination, path)); this.entries.push(Object.freeze({kind: 'directory', path}));
  }
  async file(source: string, path: string, database: false | 'metadata' | 'journal' = false): Promise<void> {
    const parent = path.split('/').slice(0, -1).join('/'); if (parent) await this.folder(parent);
    this.claim(path); const remaining = this.bounds.maximumBytes - this.bytes;
    const result = database ? await copyDatabase(this.io, source, child(this.destination, path), remaining, database)
      : await copyFile(this.io, source, child(this.destination, path), remaining);
    this.bytes += result.bytes; this.entries.push(Object.freeze({kind: 'file', path, bytes: result.bytes, sha256: result.sha256}));
  }
  async published(source: string, path: string): Promise<boolean> {
    try {await this.io.issue(() => lstat(source, {bigint: true}));}
    catch (error) {if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error;}
    await this.visit(source, path); return true;
  }
  private async visit(source: string, path: string): Promise<void> {
    const before = await directory(this.io, source); await this.folder(path);
    const names = await this.children(source, path);
    for (const name of names) {
      const relative = path + '/' + name; const from = child(source, name); const info = await this.io.issue(() => lstat(from, {bigint: true}));
      if (info.isDirectory()) await this.visit(from, relative);
      else if (info.isFile()) await this.file(from, relative);
      else throw new RecoveryError('integrity');
    }
    if (stable(before) !== stable(await directory(this.io, source))) throw new RecoveryError('integrity');
  }
  private async children(source: string, prefix: string): Promise<string[]> {
    const directory = await this.io.acquire(() => opendir(source, {bufferSize: 32}), value => value.close()); const names: string[] = [];
    try {
      while (true) {
        const next = await this.io.issue(() => directory.value.read()); if (!next) break;
        child(source, next.name);
        this.reserve(prefix + '/' + next.name);
        names.push(next.name);
      }
    } finally {await this.io.close(directory);}
    return names.sort();
  }
  snapshot() {
    return Object.freeze({entries: Object.freeze([...this.entries]), bytes: this.bytes,
      files: this.entries.filter(entry => entry.kind === 'file').length, directories: this.entries.filter(entry => entry.kind === 'directory').length});
  }
}
