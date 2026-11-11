import { MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import type { MailboxFile } from '../../wrapper/live-mailbox/index.js';
import { compiled } from '../suite/fixtures.js';
export function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(pass => {resolve = pass;}); return {promise, resolve};
}
export class MemoryMailbox implements MailboxFile {
  readonly bytes = new Uint8Array(MAILBOX_BYTES);
  produced = 0; closes = 0;
  writeGate: Promise<void> | undefined; closeGate: Promise<void> | undefined;
  readonly firstWrite = deferred();
  async size(): Promise<number> {return this.bytes.length;}
  async write(bytes: Uint8Array, position: number): Promise<number> {
    this.firstWrite.resolve(); await this.writeGate; this.bytes.set(bytes, position); this.produced += bytes.length; return bytes.length;
  }
  async close(): Promise<void> {this.closes++; await this.closeGate;}
}
export function liveInput() {
  return {suite: compiled(), scope: {organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003', generation: 1},
    uid: 10001, maximumBytes: 1048576, timeoutMs: 10000, signal: new AbortController().signal,
    clock: {wall: () => 1800000000000, monotonic: () => 0}};
}
