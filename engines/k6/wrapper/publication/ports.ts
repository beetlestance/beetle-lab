import { lstat, open, realpath, link, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export interface PublicationFile {
  stat(): Promise<Stats>;
  sync(): Promise<void>;
  close(): Promise<void>;
  write(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
}
/** Private deterministic IO seam. Public options never carry ports. */
export interface PublicationIo {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number, mode?: number): Promise<PublicationFile>;
  link(source: string, target: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export const nodeIo: PublicationIo = Object.freeze({ lstat, realpath, open, link, unlink });
