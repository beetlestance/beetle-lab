import { encodeMailboxHeader, MAILBOX_BYTES, MAILBOX_HEADER_BYTES, MAILBOX_FOOTER_OFFSET,
  MAILBOX_PAYLOAD_BYTES, type MailboxHash } from '@beetle/contracts/live-mailbox';
import type { LiveMetricSink } from '../live/index.js';
export { openNativeMailbox, NativeMailboxError } from './native.js';

export interface MailboxFile {
  size(): Promise<number>;
  write(bytes: Uint8Array, position: number): Promise<number>;
  close(): Promise<void>;
}
export interface MailboxSinkOptions {readonly file: MailboxFile; readonly hash: MailboxHash; readonly maximumProducedBytes: number}
type Reason = 'invalid_options' | 'invalid_input' | 'busy' | 'closed' | 'quota' | 'aborted' | 'io';
export class MailboxSinkError extends Error {
  constructor(readonly code: Reason) {super('Live mailbox write failed'); this.name = 'MailboxSinkError';}
}
interface State {status: 'open' | 'stopping' | 'closed' | 'failed'; reason: Reason | null; revision: number;
  chargedBytes: number; writing: boolean; quiescence: 'unknown' | 'confirmed' | 'failed'}
export interface MailboxSink extends LiveMetricSink {state(): Readonly<State>}
export function createMailboxSink(options: MailboxSinkOptions): MailboxSink {
  try {
    if (!Number.isInteger(options.maximumProducedBytes) || options.maximumProducedBytes < 1 || options.maximumProducedBytes > 4294967296) throw new Error();
    if (typeof options.hash !== 'function') throw new Error();
    return new Sink({maximumProducedBytes: options.maximumProducedBytes, hash: options.hash,
      file: {size: options.file.size.bind(options.file), write: options.file.write.bind(options.file), close: options.file.close.bind(options.file)}});
  } catch {throw new MailboxSinkError('invalid_options');}
}
class Sink implements MailboxSink {
  private facts: State = {status: 'open', reason: null, revision: 0, chargedBytes: 0, writing: false, quiescence: 'unknown'};
  private original: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: MailboxSinkOptions) {}
  state(): Readonly<State> {return Object.freeze({...this.facts});}
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (this.facts.status !== 'open') return Promise.reject(new MailboxSinkError('closed'));
    if (this.original) return Promise.reject(new MailboxSinkError('busy'));
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAILBOX_PAYLOAD_BYTES) return Promise.reject(new MailboxSinkError('invalid_input'));
    if (signal.aborted) return Promise.reject(new MailboxSinkError('aborted'));
    const charge = bytes.length + 4 * MAILBOX_HEADER_BYTES;
    if (this.facts.revision >= 65536 || charge > this.options.maximumProducedBytes - this.facts.chargedBytes) return Promise.reject(new MailboxSinkError('quota'));
    const frame = Uint8Array.from(bytes); const revision = this.facts.revision + 1;
    this.facts = {...this.facts, revision, chargedBytes: this.facts.chargedBytes + charge, writing: true};
    const original = Promise.resolve().then(() => this.publish(frame, revision, signal)).catch(error => {
      const reason = error instanceof MailboxSinkError ? error.code : 'io';
      this.facts = {...this.facts, status: 'failed', reason}; throw new MailboxSinkError(reason);
    }).finally(() => {this.original = undefined; this.facts = {...this.facts, writing: false};});
    this.original = original; return original;
  }
  private check(signal: AbortSignal): void {
    if (signal.aborted) throw new MailboxSinkError('aborted');
    if (this.closing) throw new MailboxSinkError('closed');
  }
  private async publish(bytes: Uint8Array, revision: number, signal: AbortSignal): Promise<void> {
    this.check(signal);
    if (await this.options.file.size() !== MAILBOX_BYTES) throw new MailboxSinkError('io');
    this.check(signal);
    const header = {revision, length: bytes.length, digest: this.options.hash(bytes)};
    const busy = encodeMailboxHeader({...header, committed: false}); const commit = encodeMailboxHeader({...header, committed: true});
    await this.writeAll(busy, 0, signal); await this.writeAll(busy, MAILBOX_FOOTER_OFFSET, signal);
    await this.writeAll(bytes, MAILBOX_HEADER_BYTES, signal);
    await this.writeAll(commit, MAILBOX_FOOTER_OFFSET, signal); await this.writeAll(commit, 0, signal);
    this.check(signal);
    if (await this.options.file.size() !== MAILBOX_BYTES) throw new MailboxSinkError('io');
    this.check(signal);
  }
  private async writeAll(bytes: Uint8Array, position: number, signal: AbortSignal): Promise<void> {
    let offset = 0;
    for (let calls = 0; offset < bytes.length; calls++) {
      this.check(signal); if (calls >= 64) throw new MailboxSinkError('io');
      const count = await this.options.file.write(bytes.subarray(offset), position + offset);
      if (!Number.isInteger(count) || count < 1 || count > bytes.length - offset) throw new MailboxSinkError('io');
      offset += count;
    }
    this.check(signal);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const original = this.original;
    this.facts = {...this.facts, status: this.facts.reason ? 'failed' : 'stopping'};
    this.closing = Promise.resolve().then(() => this.finish(original)); return this.closing;
  }
  private async finish(original: Promise<void> | undefined): Promise<void> {
    if (original) await original.catch(() => { /* Error retained in state and returned to original caller. */ });
    try {
      await this.options.file.close();
      this.facts = {...this.facts, status: this.facts.reason ? 'failed' : 'closed', quiescence: 'confirmed'};
    } catch {
      this.facts = {...this.facts, status: 'failed', reason: this.facts.reason ?? 'io', quiescence: 'failed'};
      throw new MailboxSinkError('io');
    }
  }
}
