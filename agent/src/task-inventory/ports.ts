import { open, lstat, realpath, opendir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { NativeClosable, OutputIO } from '../collection/output/index.js';
export interface InventoryDirectory extends NativeClosable { read(): Promise<{ readonly name: unknown } | null> }
export interface InventoryPorts {
  readonly platform: string;
  readonly open: typeof open; readonly lstat: typeof lstat; readonly realpath: typeof realpath;
  child(parent: FileHandle, name?: string): string;
  directory(path: string): Promise<InventoryDirectory>;
  mount(handle: FileHandle, io: OutputIO): Promise<string>;
}
async function mount(handle: FileHandle, io: OutputIO): Promise<string> {
  const file = await io.io(() => open(`/proc/self/fdinfo/${handle.fd}`, 'r').then(value => { io.own(value); return value; }));
  try {
    const bytes = Buffer.alloc(4097); let position = 0;
    for (;;) {
      const read = await io.io(() => file.read(bytes, position, bytes.length - position, position));
      if (!read.bytesRead) break; position += read.bytesRead;
      if (position === bytes.length) throw new Error('fdinfo overflow');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, position));
    const rows = text.split('\n').filter(line => line.startsWith('mnt_id:'));
    if (rows.length !== 1 || !/^mnt_id:\s+[1-9][0-9]{0,19}$/.test(rows[0]!)) throw new Error('fdinfo mount');
    return rows[0]!.split(/\s+/)[1]!;
  } finally { await io.closeHandles([file]); }
}
/** Production Linux-only descriptor bridge. No caller path is accepted by the public owner. */
export const inventoryPorts: InventoryPorts = {
  platform: process.platform, open, lstat, realpath,
  child: (handle, name) => `/proc/self/fd/${handle.fd}${name === undefined ? '' : `/${name}`}`,
  // Node supports byte names; @types/node24 narrows this option to text encodings.
  // Each returned name remains unknown and is checked as a Buffer at the boundary.
  directory: path => opendir(path, { encoding: 'buffer' as BufferEncoding, bufferSize: 1 }), mount,
};
