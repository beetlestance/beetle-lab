import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { OutputByteError } from '../../../../ports/output-bytes.js';
import type { OutputByteStore, OutputFileContext, OutputFileJob, OutputFileRecord, OutputFileReceipt } from '../../../../ports/output-bytes.js';
import { nativePort, pinRoots } from '../custody/index.js';
import type { NativePort, Roots } from '../custody/index.js';
import { openOutputLease } from './lease.js';
import type { OutputLease } from './lease.js';
import { fields, record, token, chunk } from './capture.js';
import { FileJob } from './job.js';
import { prepare, append, publish } from './mutations.js';
import { read } from './content.js';
import { fail, safeError } from './errors.js';

export interface StoreOptions { stagingRoot: string; publishedRoot: string; leasePath: string; createLease: boolean }
let processOwner: LocalOutputStore | undefined;
class LocalOutputStore implements OutputByteStore {
  private roots!: Roots;
  private lease?: OutputLease;
  private port!: NativePort;
  private clock!: () => number;
  private readonly jobs = new Set<FileJob<unknown>>();
  private readonly tokens = new Map<string, FileJob<unknown>>();
  private fenced = false;
  private broken = false;
  private closing?: Promise<void>;
  async initialize(options: StoreOptions, seam?: { nativePort: NativePort; clock?: () => number }): Promise<void> {
    try {
      const { stagingRoot, publishedRoot, leasePath, createLease } = captureOptions(options);
      this.lease = await openOutputLease({ path: leasePath as string, create: createLease });
      this.port = seam?.nativePort ?? nativePort; this.clock = seam?.clock ?? (() => performance.now());
      this.roots = await pinRoots(this.port, stagingRoot as string, publishedRoot as string); await this.lease.check();
    } catch (error) {
      if (safeError(error).code === 'cleanup') this.broken = true;
      try { await this.close(); } catch { fail('cleanup'); }
      throw safeError(error);
    }
  }
  private done(job: FileJob<unknown>): void {
    this.jobs.delete(job);
    if (job.token) this.tokens.delete(job.token);
  }
  private stop(): void { this.fenced = true; for (const job of this.jobs) job.policy.controller.abort(); }
  private run<T>(context: OutputFileContext, capture: (job: FileJob<unknown>, claim: (input: unknown) => OutputFileRecord) => () => Promise<T>): OutputFileJob<T> {
    if (this.fenced || this.jobs.size >= 2) return this.refused(this.fenced ? 'closed' : 'busy');
    const job = new FileJob<T>({ port: this.port, roots: this.roots, lease: this.lease!, clock: this.clock,
      done: owner => this.done(owner), broken: () => { this.broken = true; this.stop(); } });
    this.jobs.add(job as FileJob<unknown>);
    try {
      const work = capture(job as FileJob<unknown>, input => {
        const key = token(input);
        if (this.tokens.has(key)) fail('busy');
        job.token = key; this.tokens.set(key, job as FileJob<unknown>);
        const value = record(input);
        if (value.artifact.token !== key) fail('invalid_input');
        return value;
      });
      job.capture(context); job.start(work);
    } catch (error) { job.refuse(error); }
    return job;
  }
  private refused<T>(code: 'closed' | 'busy'): OutputFileJob<T> {
    return { result: Promise.reject(new OutputByteError(code)), settled: Promise.resolve() };
  }
  prepare(input: OutputFileRecord, context: OutputFileContext): OutputFileJob<OutputFileReceipt> {
    return this.run(context, (job, claim) => { const value = claim(input); return () => prepare(job, this.roots, value); });
  }
  publish(input: OutputFileRecord, context: OutputFileContext): OutputFileJob<OutputFileReceipt> {
    return this.run(context, (job, claim) => { const value = claim(input); return () => publish(job, this.roots, value); });
  }
  append(input: Parameters<OutputByteStore['append']>[0], context: OutputFileContext): OutputFileJob<OutputFileReceipt> {
    return this.run(context, (job, claim) => {
      const request = fields(input, ['record', 'offset', 'bytes']); const value = claim(request.record); const bytes = chunk(request.bytes);
      if (typeof request.offset !== 'number' || !Number.isSafeInteger(request.offset) || request.offset < 0) fail('invalid_input');
      const offset = request.offset; return () => append(job, this.roots, value, { offset, bytes });
    });
  }
  read(input: Parameters<OutputByteStore['read']>[0], context: OutputFileContext): OutputFileJob<void> {
    return this.run(context, (job, claim) => {
      const request = fields(input, ['record', 'start', 'endExclusive', 'sink']); const value = claim(request.record);
      const sink = fields(request.sink, ['write']); if (typeof sink.write !== 'function') fail('invalid_input');
      if (typeof request.start !== 'number' || typeof request.endExclusive !== 'number') fail('invalid_input');
      const range = { start: request.start, endExclusive: request.endExclusive,
        write: (bytes: Uint8Array) => Reflect.apply(sink.write as (bytes: Uint8Array) => Promise<void>, request.sink, [bytes]) as Promise<void> };
      return () => read(job, this.roots, value, range);
    });
  }
  close(): Promise<void> { this.stop(); this.closing ??= this.drain(); return this.closing; }
  private async drain(): Promise<void> {
    await Promise.allSettled([...this.jobs].map(job => job.result));
    if (this.broken) fail('cleanup');
    try { await this.lease?.close(); } catch (error) { this.broken = true; throw safeError(error); }
    if (processOwner === this) processOwner = undefined;
  }
}
/** Private native/clock fault seam; production callers use index.ts only. */
export function openStore(options: StoreOptions, seam?: { nativePort: NativePort; clock?: () => number }): Promise<OutputByteStore> {
  if (processOwner) return Promise.reject(new OutputByteError('busy'));
  const owner = new LocalOutputStore(); processOwner = owner;
  return owner.initialize(options, seam).then(() => owner);
}
function captureOptions(options: StoreOptions): StoreOptions {
  const captured = fields(options, ['stagingRoot', 'publishedRoot', 'leasePath', 'createLease']);
  const { stagingRoot, publishedRoot, leasePath, createLease } = captured;
  if (![stagingRoot, publishedRoot, leasePath].every(value => typeof value === 'string')) fail('invalid_input');
  if (typeof createLease !== 'boolean') fail('invalid_input');
  if (dirname(stagingRoot as string) !== dirname(leasePath as string) || dirname(publishedRoot as string) !== dirname(leasePath as string)) fail('invalid_input');
  return captured as unknown as StoreOptions;
}
