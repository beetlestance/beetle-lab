import type { BigIntStats } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import type { RecoveryIO } from './io.js';
import { child, directory } from './files.js';
import { RecoveryError } from './types.js';
export async function knownTree(io: RecoveryIO, root: string, expected: ReadonlyMap<string, 'directory' | 'file'>): Promise<number> {
  let count = 0;
  async function visit(relative: string): Promise<void> {
    const path = relative ? child(root, relative) : root; await directory(io, path);
    const handle = await io.acquire(() => opendir(path, {bufferSize: 32}), dir => dir.close()); const folders: string[] = [];
    try {
      while (true) {
        const next = await io.issue(() => handle.value.read()); if (!next) break;
        if (++count > expected.size) throw new RecoveryError('integrity');
        const name = relative ? relative + '/' + next.name : next.name; const kind = expected.get(name);
        if (!kind) throw new RecoveryError('integrity');
        const info = await io.issue(() => lstat(child(root, name), {bigint: true}));
        if (!matchesKind(info, kind)) throw new RecoveryError('integrity'); if (kind === 'directory') folders.push(name);
      }
    } finally {await io.close(handle);}
    for (const name of folders) await visit(name);
  }
  await visit(''); return count;
}

function matchesKind(info: BigIntStats, kind: 'file' | 'directory'): boolean {return kind === 'file' ? info.isFile() : info.isDirectory();}
