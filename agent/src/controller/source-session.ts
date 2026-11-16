import type { Reservation } from '../admission/index.js';
import type { OutputCollectionResult, OutputRootIdentity } from '../collection/output/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';
import type { FailedOutputCollection } from '../journal/index.js';
import { receiptForOutputSource } from '../output-source/index.js';
import type { CollectionIntent, CollectedSource, FinishedRelease, SourceReceipt } from '../output-source/index.js';
import type { LaunchState } from '../supervisor/index.js';
import type { CollectionAuthority } from './authority.js';
import { collectedRequest, failedRequest, newIntent, sourceHash } from './source-evidence.js';
import { checkRecovered, checkReleased, checkRoot, sameSourceFact } from './source-recovery.js';
import { ControllerError } from './types.js';
import type { AttemptProgress, ControllerPorts } from './types.js';

/** Sole owner of original source requests and fresh/recovered failure authority. */
export class SourceSession {
  private loading: Promise<void> | undefined;
  private intent: CollectionIntent | undefined;
  private begun = false;
  private request: CollectedSource | undefined;
  private expected: SourceReceipt | undefined;
  private receipt: SourceReceipt | undefined;
  private finishedRelease: FinishedRelease | undefined;
  private failure: FailedOutputCollection | undefined;
  private succeeded = false;
  private failedRecovery = false;
  recovered = false;
  constructor(private readonly options: ControllerPorts) {}
  get hasCustody(): boolean { return Boolean(this.intent || this.receipt); }
  get hasPendingPublication(): boolean { return this.succeeded || Boolean(this.receipt || this.failure); }
  get checkpoint(): Readonly<WrapperCheckpoint> | undefined { return this.intent?.checkpoint; }
  load(): Promise<void> { return this.loading ??= this.readInitial(); }
  private async readInitial(): Promise<void> {
    try {
      const { journal, input } = this.options;
      const source = await journal.readOutputSource(input.key);
      if (source) { this.receipt = receiptForOutputSource(source, sourceHash); this.finishedRelease = source.release; return; }
      const intent = await journal.readOutputCollection(input.key);
      if (intent) { this.intent = intent; this.recovered = true; this.begun = true; }
    } catch (error) { this.loading = undefined; throw error; }
  }
  async begin(input: { authority: CollectionAuthority; current: Reservation; state: LaunchState;
    root: Readonly<OutputRootIdentity>; checkpoint: Readonly<WrapperCheckpoint>; now: number }): Promise<boolean> {
    if (this.failedRecovery || this.succeeded) throw new ControllerError('journal');
    checkRoot(this.options, input.root);
    if (this.recovered) checkRecovered({ ...input, options: this.options, intent: this.intent! });
    if (!this.intent) this.intent = newIntent(input) ?? undefined;
    if (!this.intent) return false;
    if (!this.begun) {
      const reply = await this.options.journal.beginOutputCollection(this.intent);
      if (!sameSourceFact(reply, this.intent)) throw new ControllerError('journal');
      this.begun = true;
    }
    return true;
  }
  success(outcome: Extract<OutputCollectionResult, { ok: true }>, now: () => number): void {
    this.succeeded = true;
    const captured = collectedRequest(this.intent!, outcome, now());
    this.request = captured.request; this.expected = captured.receipt;
    this.finishedRelease = captured.request.release;
  }
  failed(now: number): void {
    if (this.recovered) { this.failedRecovery = true; throw new ControllerError('journal'); }
    if (this.succeeded) throw new ControllerError('journal');
    this.failure ??= failedRequest(this.intent!, now);
  }
  async publish(): Promise<void> {
    if (!this.request || !this.expected) throw new ControllerError('journal');
    const stored = await this.options.journal.readOutputSource(this.options.input.key);
    const receipt = stored ? receiptForOutputSource(stored, sourceHash)
      : await this.options.journal.commitOutputSource(this.request);
    if (!sameSourceFact(receipt, this.expected)) throw new ControllerError('journal');
    this.receipt = receipt;
  }
  async progress(): Promise<AttemptProgress> {
    if (this.receipt) {
      checkReleased(await this.options.journal.releaseOutputSource(this.receipt), this.finishedRelease!);
      return { kind: 'released', collection: 'finished' };
    }
    if (this.failure) {
      checkReleased(await this.options.journal.failOutputCollection(this.failure), this.failure.evidence);
      return { kind: 'released', collection: 'failed' };
    }
    await this.publish();
    return { kind: 'awaiting_release', collection: 'finished' };
  }
}
