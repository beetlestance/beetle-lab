export interface MailboxFile {
  size(): Promise<number>;
  write(bytes: Uint8Array, position: number): Promise<number>;
  close(): Promise<void>;
}
