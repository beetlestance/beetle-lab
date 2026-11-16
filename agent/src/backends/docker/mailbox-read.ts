import type { ClientRequest, IncomingMessage, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { LIVE_MAILBOX_PATH } from '@beetle/contracts/live-mailbox';
import { captureMailboxArchive, MAILBOX_ARCHIVE_BYTES } from './mailbox-tar.js';
import type { FailureReason, MailboxArchiveRequest, MailboxArchiveReply } from './types.js';

interface Options {socketPath: string; input: MailboxArchiveRequest; factory: typeof httpRequest}
/** One actual request/response lifetime, not merely an abort acknowledgement. */
export function readMailboxOriginal(options: Options): Promise<MailboxArchiveReply> {return new Original(options).run();}
class Original {
  private request: ClientRequest | undefined;
  private response: IncomingMessage | undefined;
  private requestClosed = false;
  private responseClosed = true;
  private issuing = false;
  private settled = false;
  private dispatched = false;
  private length = 0;
  private fragments = 0;
  private readonly buffer = Buffer.alloc(MAILBOX_ARCHIVE_BYTES);
  private decision: MailboxArchiveReply | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resolve!: (reply: MailboxArchiveReply) => void;
  private readonly completion = new Promise<MailboxArchiveReply>(resolve => {this.resolve = resolve;});
  private readonly abort = () => this.fail('aborted');
  constructor(private readonly options: Options) {}
  run(): Promise<MailboxArchiveReply> {
    const {input, factory, socketPath} = this.options;
    this.timer = setTimeout(() => this.fail('deadline'), Math.max(1, input.deadline - performance.now()));
    input.signal?.addEventListener('abort', this.abort, {once: true});
    if (input.signal?.aborted) {this.fail('aborted'); return this.completion;}
    this.issuing = true;
    try {
      this.request = factory({socketPath, method: 'GET', agent: false, maxHeaderSize: 16384,
        path: `/v1.47/containers/${input.containerId}/archive?path=${encodeURIComponent(LIVE_MAILBOX_PATH)}`,
        headers: {accept: 'application/x-tar'}});
      this.request.on('close', () => {this.requestClosed = true; if (!this.decision) this.fail('unavailable'); this.finish();});
      this.request.on('error', () => {if (!this.decision) this.fail('unavailable');});
      this.request.on('response', response => this.receive(response));
      this.issuing = false;
      this.dispatch();
    } catch {this.issuing = false; this.fail('unavailable');}
    return this.completion;
  }
  private dispatch(): void {
    if (this.decision) {this.destroy(); this.finish(); return;}
    if (this.options.input.signal?.aborted) {this.fail('aborted'); return;}
    if (performance.now() >= this.options.input.deadline) {this.fail('deadline'); return;}
    this.dispatched = true; this.request!.end();
  }
  private receive(response: IncomingMessage): void {
    this.response = response; this.responseClosed = false;
    response.on('close', () => {this.responseClosed = true; if (!this.decision) this.fail('unavailable'); this.finish();});
    response.on('error', () => {if (!this.decision) this.fail('unavailable');});
    response.on('aborted', () => {if (!this.decision) this.fail('unavailable');});
    if (this.decision) {response.destroy(); return;}
    if (!this.headers(response)) {this.fail('malformed'); return;}
    response.on('data', (chunk: unknown) => this.data(chunk));
    response.on('end', () => this.end(response));
  }
  private headers(response: IncomingMessage): boolean {
    if (!response.statusCode || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return false;
    const size = response.headers['content-length'];
    return size === undefined || /^[0-9]{1,8}$/.test(size) && Number(size) <= MAILBOX_ARCHIVE_BYTES;
  }
  private data(chunk: unknown): void {
    if (this.decision) return;
    if (!Buffer.isBuffer(chunk)) {this.fail('malformed'); return;}
    if (++this.fragments > 256 || chunk.length > this.buffer.length - this.length) {this.fail('response_limit'); return;}
    chunk.copy(this.buffer, this.length); this.length += chunk.length;
  }
  private end(response: IncomingMessage): void {
    if (this.decision) return;
    if (!response.complete) {this.fail('unavailable'); return;}
    try {
      const status = response.statusCode!;
      this.decision = {ok: true, status, image: status === 200 ? captureMailboxArchive(this.buffer.subarray(0, this.length)) : null};
      this.destroy(); this.finish();
    } catch {this.fail('malformed');}
  }
  private fail(reason: FailureReason): void {
    if (this.settled) return;
    if (!this.decision || this.decision.ok || reason === 'aborted' || reason === 'deadline') this.decision = {ok: false, reason, dispatched: this.dispatched};
    this.destroy(); this.finish();
  }
  private destroy(): void {this.response?.destroy(); this.request?.destroy();}
  private quiescent(): boolean {return !this.issuing && (!this.request || this.requestClosed) && this.responseClosed;}
  private finish(): void {
    if (this.settled || !this.decision || !this.quiescent()) return;
    let reply = this.decision;
    if (this.options.input.signal?.aborted) reply = {ok: false, reason: 'aborted', dispatched: this.dispatched};
    else if (performance.now() >= this.options.input.deadline) reply = {ok: false, reason: 'deadline', dispatched: this.dispatched};
    this.settled = true; clearTimeout(this.timer); this.options.input.signal?.removeEventListener('abort', this.abort); this.resolve(reply);
  }
}
