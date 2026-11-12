import type { OutputBinding } from '../../domain/output-owner/index.js';
import { OutputTransferError } from '../../ports/output-transfer.js';
import type { OutputTransferJob, OutputTransferOptions, OutputTransferOutcome, OutputTransfers } from '../../ports/output-transfer.js';
import { TransferOwner } from './ownership.js';
import { binding, same } from './validation.js';
import { fail, requireTransfer as check, safeError } from './errors.js';
import { loadSource } from './source.js';
import { transferArtifact } from './artifact.js';

const parents = new WeakMap<object, OutputTransfers<OutputBinding>>();
class Transfers implements OutputTransfers<OutputBinding> {
  private readonly jobs = new Set<TransferOwner>();
  private readonly bindings = new Map<TransferOwner, OutputBinding>();
  private fenced = false;
  private closing?: Promise<void>;
  private rejectCleanup!: (error: Error) => void;
  private readonly cleanup = new Promise<never>((_, reject) => { this.rejectCleanup = reject; });
  private lastTime = -1;
  constructor(private readonly options: OutputTransferOptions<OutputBinding>) { void this.cleanup.catch(() => {}); }
  private clock = (): number => {
    let now: number;
    try { now = (this.options.monotonicNow ?? (() => performance.now()))(); } catch { fail('invalid_input'); }
    check(typeof now === 'number' && Number.isFinite(now) && now >= this.lastTime && now >= 0, 'invalid_input');
    this.lastTime = now; return now;
  };
  private stop(): void { this.fenced = true; for (const job of this.jobs) job.controller.abort(); }
  private quarantine(): void { this.stop(); this.rejectCleanup(new OutputTransferError('cleanup')); }
  transfer(input: OutputBinding, signal?: AbortSignal): OutputTransferJob<OutputBinding> {
    if (this.fenced || this.jobs.size >= 2) return refused(this.fenced ? 'closed' : 'busy');
    const owner = new TransferOwner({retire: () => { this.jobs.delete(owner); this.bindings.delete(owner); },
      quarantine: () => this.quarantine()});
    this.jobs.add(owner);
    let result: Promise<OutputTransferOutcome<OutputBinding>>;
    try {
      const captured = binding(input); owner.check();
      check(![...this.bindings.values()].some(value => same(value, captured)), 'busy');
      this.bindings.set(owner, captured); owner.attach(signal); owner.check(); this.clock(); owner.check();
      result = this.run(owner, captured);
    } catch (error) { result = Promise.reject(safeError(error)); }
    result = result.catch(error => { throw safeError(error); }).finally(() => owner.finish());
    return {result, settled: owner.settled};
  }
  private async run(owner: TransferOwner, original: OutputBinding): Promise<OutputTransferOutcome<OutputBinding>> {
    const loaded = await loadSource(this.options, owner, original);
    if (!loaded) { owner.check(); return {kind: 'pending'}; }
    for (const artifact of loaded.state.artifacts) {
      await transferArtifact({options: this.options, owner, clock: this.clock,
        key: {binding: original, manifestDigest: loaded.state.manifestDigest, sourceDigest: loaded.state.sourceDigest,
          ordinal: artifact.ordinal}}, {binding: original, artifact});
    }
    owner.check(); return {kind: 'published', binding: original,
      manifestDigest: loaded.state.manifestDigest, sourceDigest: loaded.state.sourceDigest};
  }
  close(): Promise<void> {
    this.stop();
    this.closing ??= Promise.race([this.cleanup, Promise.all([...this.jobs].map(owner => owner.settled)).then(() => {
      parents.delete(this.options.files);
    })]);
    return this.closing;
  }
}
function refused(code: 'closed' | 'busy'): OutputTransferJob<OutputBinding> {
  return {result: Promise.reject(new OutputTransferError(code)), settled: Promise.resolve()};
}
/** Owns two serial run producers; injected gateway, metadata and files stay open. */
export function createOutputTransfers(options: OutputTransferOptions<OutputBinding>): OutputTransfers<OutputBinding> {
  try {
    const captured: OutputTransferOptions<OutputBinding> = Object.freeze({metadata: options.metadata, gateway: options.gateway, files: options.files,
      freeSpaceReserveBytes: options.freeSpaceReserveBytes, newWriterId: options.newWriterId,
      ...(options.digest === undefined ? {} : {digest: options.digest}),
      ...(options.monotonicNow === undefined ? {} : {monotonicNow: options.monotonicNow})});
    check(Number.isSafeInteger(captured.freeSpaceReserveBytes) && captured.freeSpaceReserveBytes >= 0, 'invalid_input');
    check(typeof captured.newWriterId === 'function', 'invalid_input');
    check(captured.digest === undefined || typeof captured.digest === 'function', 'invalid_input');
    check(captured.monotonicNow === undefined || typeof captured.monotonicNow === 'function', 'invalid_input');
    check(captured.files !== null && typeof captured.files === 'object', 'invalid_input');
    if (parents.has(captured.files)) fail('busy');
    const owner = new Transfers(captured); parents.set(captured.files, owner); return owner;
  } catch (error) {
    if (error instanceof OutputTransferError) throw error;
    fail('invalid_input');
  }
}
