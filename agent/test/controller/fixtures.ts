import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach } from 'vitest';
import { sealEngineResult } from '@beetle/contracts';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import type { ControlReader, ControlReaderOptions, ControlReadBudget, ControlReadOperation } from '../../src/collection/control/index.js';
import type { OutputCollectionOptions, OutputCollection } from '../../src/collection/output/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../../src/control-protocol/index.js';
import { AttemptController } from '../../src/controller/attempt.js';
import type { ControllerPorts } from '../../src/controller/types.js';
import { controlled, supervisorFixture, scope } from '../supervisor/fixtures.js';

export const budget = () => ({ deadline: performance.now() + 5000 });
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class ScriptReader implements ControlReader {
  checkpoint: Readonly<WrapperCheckpoint> | null;
  pending: WrapperBatch | undefined;
  readonly budgets: ControlReadBudget[] = [];
  closeCalls = 0;
  failed = false;
  closeFailure = false;
  private closing: Promise<void> | undefined;
  constructor(options: ControlReaderOptions, events: ControlEvent[]) {
    this.checkpoint = options.checkpoint;
    if (!this.checkpoint && events.length) this.pending = { key: options.key, expected: null,
      next: { version: 1, dev: '1', ino: '2', offset: Buffer.byteLength(events.map(e => JSON.stringify(e) + '\n').join('')),
        wrapperSeq: events.length, prefixSha256: hash(events.map(e => JSON.stringify(e) + '\n').join('')) }, events };
  }
  read(budget: ControlReadBudget): ControlReadOperation {
    this.budgets.push(budget);
    const result = this.failed ? { ok: false as const, reason: 'corruption' as const }
      : this.pending ? { ok: true as const, value: { kind: 'batch' as const, request: this.pending } }
        : budget.stopped && this.checkpoint
          ? { ok: true as const, value: { kind: 'caught_up' as const, cursor: this.checkpoint,
            tail: 'none' as const, consistency: 'stopped_verified' as const } }
          : { ok: true as const, value: { kind: 'caught_up' as const, cursor: this.checkpoint,
            tail: 'none' as const, consistency: 'live_provisional' as const } };
    return { result: Promise.resolve(result), quiesced: Promise.resolve() };
  }
  accept(checkpoint: Readonly<WrapperCheckpoint>): void { this.checkpoint = checkpoint; this.pending = undefined; }
  close(): Promise<void> {
    this.closeCalls++;
    this.closing ??= this.closeFailure ? Promise.reject(new Error('synthetic close')) : Promise.resolve();
    return this.closing;
  }
}
export function fixture() {
  const controllers: AttemptController[] = [];
  afterEach(async () => { await Promise.allSettled(controllers.splice(0).map(controller => controller.close())); });
  const f = supervisorFixture();
  return { ...f, async setupController() {
    const env = await f.setup(); const owner = controlled(env.journal, env.time);
    const key = scope(env.offer);
    const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
    const { seal: _seal, ...body } = original; void _seal;
    const signed = sealEngineResult({ ...body, ...key, artifacts: [] }, '2026-01-01T00:00:00Z', hash);
    if (!signed.ok) throw new Error(signed.code);
    const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', observedAt: '2026-01-01T00:00:00Z',
      kind: 'engine.result', payload: signed.value };
    const readers: ScriptReader[] = []; const collections: OutputCollectionOptions[] = [];
    let outputClose = 0; let output: ((options: OutputCollectionOptions) => OutputCollection) | undefined;
    const controllerOptions: ControllerPorts = { journal: env.journal, supervisor: owner.manager,
      input: env.input, wallNow: env.time.wall, createReader: options => {
        const reader = new ScriptReader(options, [event]); readers.push(reader); return reader;
      }, collectOutputs: options => {
        collections.push(options);
        return output ? output(options) : { result: Promise.resolve({ ok: true, value: options.reportedResult,
          verifiedBytes: options.controlBytes + 1,
          // Synthetic collector for orchestration tests; these are not filesystem/source receipts.
          custody: { resultFileBytes: 1, controlBytes: options.controlBytes,
            root: { directory: options.directory, uid: options.uid, device: '0', inode: '0', modifiedNs: '0', changedNs: '0' } } }), quiesced: Promise.resolve(),
        close: () => { outputClose++; return Promise.resolve(); } };
      } };
    const controller = new AttemptController(controllerOptions);
    controllers.push(controller);
    return { ...env, ...owner, controller, readers, collections, key, event,
      controllerOptions, outputClose: () => outputClose, setOutput(value: typeof output) { output = value; } };
  } };
}
