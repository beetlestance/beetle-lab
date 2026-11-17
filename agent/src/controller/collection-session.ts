import { performance } from 'node:perf_hooks';

import { type ControlReader, type ControlReadValue, CONTROL_READ_MAX_MS } from '../collection/control/index.js';
import { OUTPUT_COLLECTION_MAX_MS, type OutputCollection } from '../collection/output/index.js';

import { collectionOptions, type CollectionAuthority } from './authority.js';

import type { SourceSession } from './source-session.js';
import { outputLocation, sameSourceFact } from './source-recovery.js';
import { ControllerError, type ControllerPorts, type ControllerBudget, type CollectionObservation } from './types.js';
interface CollectionSessionOptions {
  ports: ControllerPorts;
  source: SourceSession;
  guard(budget: ControllerBudget): void;
  now(): number;
  failCleanup(): void;
  recordCollection(value: CollectionObservation): void;
  cancel(): Promise<void>;
  authority(): CollectionAuthority;
  outputDeadline(): number;
}
export class CollectionSession {
  private reader: ControlReader | undefined;
  private outputs: OutputCollection | undefined;
  constructor(private readonly options: CollectionSessionOptions) {}
  closeOutputs(): Promise<void> | undefined {
    return this.outputs?.close();
  }
  private directory(): string {
    return outputLocation(this.options.ports).directory;
  }
  private uid(): number {
    return outputLocation(this.options.ports).uid;
  }
  async read(stopped: boolean, budget: ControllerBudget): Promise<ControlReadValue | null> {
    if (!this.reader) {
      const checkpoint = await this.options.ports.journal.readWrapperCheckpoint(this.options.ports.input.key);
      this.options.guard(budget);
      if (this.options.source.recovered && !sameSourceFact(checkpoint, this.options.source.checkpoint))
        throw new ControllerError('journal');
      this.reader = this.options.ports.createReader({
        directory: this.directory(),
        uid: this.uid(),
        key: this.options.ports.input.key,
        checkpoint,
      });
    }
    const read = this.reader.read({
      ...budget,
      stopped,
      deadline: Math.min(budget.deadline, performance.now() + CONTROL_READ_MAX_MS),
    });
    const result = await this.originals(read, () => this.reader!.close(), false);
    this.options.guard(budget);
    if (!result.ok) {
      await this.closeReader();
      if (this.options.source.recovered) throw new ControllerError('journal');
      this.options.recordCollection({ state: 'failed', observedAt: this.options.now() });
      return null;
    }
    if (result.value.kind === 'batch') {
      if (this.options.source.recovered) throw new ControllerError('journal');
      const checkpoint = await this.commitControl(result.value.request);
      this.reader.accept(checkpoint);
    }
    return result.value;
  }
  async closeReader(): Promise<void> {
    try {
      await this.reader?.close();
    } catch {
      this.options.failCleanup();
      throw new ControllerError('cleanup');
    }
  }
  private async commitControl(request: Parameters<ControllerPorts['journal']['commitWrapperBatch']>[0]) {
    try {
      return await this.options.ports.journal.commitWrapperBatch(request);
    } catch {
      // Preserve the pending immutable batch for ambiguous replay, but fence further execution.
      await this.options.cancel().catch(() => undefined);
      throw new ControllerError('journal');
    }
  }
  private async originals<T>(
    operation: { result: Promise<T>; quiesced: Promise<void> },
    close: () => Promise<void>,
    closeAlways: boolean,
  ): Promise<T> {
    let closing: Promise<void> | undefined;
    const closeOnce = () => (closing ??= Promise.resolve().then(close));
    const failed = async () => {
      this.options.failCleanup();
      await closeOnce().catch(() => undefined);
      throw new ControllerError('cleanup');
    };
    const outcomes = await Promise.allSettled([operation.result.catch(failed), operation.quiesced.catch(failed)]);
    const result = outcomes[0];
    if (result.status !== 'fulfilled' || outcomes[1].status !== 'fulfilled') throw new ControllerError('cleanup');
    if (closeAlways) {
      try {
        await closeOnce();
      } catch {
        this.options.failCleanup();
        throw new ControllerError('cleanup');
      }
    }
    return result.value;
  }
  async collect(
    result: NonNullable<CollectionObservation['result']>,
    controlBytes: number,
    budget: ControllerBudget,
  ): Promise<void> {
    this.options.guard(budget);
    const deadline = Math.min(
      budget.deadline,
      performance.now() + OUTPUT_COLLECTION_MAX_MS,
      this.options.source.recovered ? Infinity : this.options.outputDeadline(),
    );
    if (performance.now() >= deadline) throw new ControllerError('deadline');
    this.outputs = this.options.ports.collectOutputs(
      collectionOptions(this.options.authority(), {
        directory: this.directory(),
        uid: this.uid(),
        key: this.options.ports.input.key,
        reportedResult: result,
        controlBytes,
        deadline,
        ...(budget.signal ? { signal: budget.signal } : {}),
      }),
    );
    const outcome = await this.originals(this.outputs, () => this.outputs!.close(), true);
    if (!outcome.ok && outcome.reason === 'busy') return;
    if (outcome.ok) this.options.source.success(outcome, () => this.options.now());
    else this.options.source.failed(this.options.now());
    this.options.recordCollection({
      state: outcome.ok ? 'finished' : 'failed',
      observedAt: this.options.now(),
      ...(outcome.ok ? { result: outcome.value } : {}),
    });
    this.options.guard(budget);
    if (outcome.ok) await this.options.source.publish();
  }
}
