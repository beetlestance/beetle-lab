import { lstat, open, realpath, link, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';

export interface PublicationFile {
  stat(): Promise<BigIntStats>;
  sync(): Promise<void>;
  close(): Promise<void>;
  write(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
}
/** Private deterministic IO seam. Public options never carry ports. */
export interface PublicationIo {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number, mode?: number): Promise<PublicationFile>;
  link(source: string, target: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export const nodeIo: PublicationIo = Object.freeze({
  lstat: (path: string) => lstat(path, { bigint: true }), realpath, link, unlink,
  open: async (path: string, flags: number, mode?: number): Promise<PublicationFile> => {
    const file = await open(path, flags, mode);
    return Object.freeze({ stat: () => file.stat({ bigint: true }), sync: () => file.sync(), close: () => file.close(),
      write: (buffer: Buffer, offset: number, length: number, position: number) => file.write(buffer, offset, length, position) });
  },
});
