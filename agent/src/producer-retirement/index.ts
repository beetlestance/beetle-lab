import { JournalError } from '../journal/index.js';
import { performance } from 'node:perf_hooks';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest, outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { captureRetirementIntent, retirementDigest } from '../retirement-values/index.js';
import type { RetirementIntent, JournalRetirements } from '../retirement-values/index.js';
import type { ProducerFence } from '../producer-gate/index.js';
import { RetirementBudget } from './budget.js';
import { mintBarrier } from './capability.js';
import { ProducerRetirementError } from './types.js';
import type { ProducerRetirementOptions, RetirementOutcome, RetirementWork } from './types.js';
export { ProducerRetirementError } from './types.js';
export { producerBarrierFacts } from './capability.js';
export type { ProducerBarrier, BarrierFacts, ProducerRetirementOptions, RetirementWork, RetirementOutcome } from './types.js';
interface Entry {
  readonly request: RetirementRequest; readonly digest: string; readonly slot: ProducerFence;
  issued: boolean; sticky: boolean; starting: boolean; drained: boolean; intent?: RetirementIntent;
  cycle?: { readonly work: RetirementWork; readonly budget: RetirementBudget; settled: boolean };
}
function keyFor(request: RetirementRequest) {
  const { organizationId, workspaceId, attemptId, generation } = request;
  return { organizationId, workspaceId, attemptId, generation };
}
function scopeId(request: RetirementRequest): string { return encodeCanonicalJson(keyFor(request), 640); }
function failure(error: unknown): RetirementOutcome {
  if (error instanceof ProducerRetirementError) return Object.freeze({ ok: false, reason: error.reason });
  if (error instanceof JournalError && ['conflict', 'stale_generation', 'not_found', 'recovery_required'].includes(error.code)) {
    return Object.freeze({ ok: false, reason: 'conflict' });
  }
  return Object.freeze({ ok: false, reason: 'unavailable' });
}
const owners = new WeakMap<JournalRetirements, ProducerRetirement>();
/** Bounded actual write/read/producer ownership, independently of caller result expiry. */
export class ProducerRetirement {
  private readonly entries = new Map<string, Entry>();
  private readonly options: ProducerRetirementOptions;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(options: ProducerRetirementOptions) {
    options.gate.assertOwner(options.journal);
    if (owners.has(options.journal)) throw new ProducerRetirementError('capacity');
    const budget = options.budgetMs ?? 30_000;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 30_000) throw new ProducerRetirementError('invalid_input');
    this.options = Object.freeze({ ...options, budgetMs: budget }); owners.set(options.journal, this);
  }
  status() { return Object.freeze({ retained: this.entries.size, closed: this.closed }); }
  retire(input: unknown): RetirementWork {
    if (this.closed) throw new ProducerRetirementError('closed');
    let request: RetirementRequest;
    try { request = captureOutputRetirementRequest(input); } catch { throw new ProducerRetirementError('invalid_input'); }
    const id = scopeId(request); const digest = outputRetirementDigest(request, retirementDigest);
    const prior = this.entries.get(id);
    if (prior) return this.resume(prior, digest);
    if (this.entries.size >= 64) throw new ProducerRetirementError('capacity');
    const entry: Entry = { request, digest, slot: this.options.gate.reserve(keyFor(request)), issued: false, sticky: false, starting: false, drained: false };
    this.entries.set(id, entry); return this.start(entry);
  }
  private resume(prior: Entry, digest: string): RetirementWork {
      if (prior.starting) throw new ProducerRetirementError('capacity');
      if (prior.digest !== digest) throw new ProducerRetirementError('conflict');
      if (!prior.cycle || !prior.cycle.settled) {
        if (!prior.cycle) throw new ProducerRetirementError('capacity'); return prior.cycle.work;
      }
      if (prior.sticky) throw new ProducerRetirementError('cleanup');
      return this.start(prior);
  }
  private start(entry: Entry): RetirementWork {
    let budget: RetirementBudget; entry.starting = true;
    try { budget = new RetirementBudget(this.options.monotonicNow ?? (() => performance.now()), this.options.budgetMs!); }
    catch (error) { entry.starting = false; if (!entry.issued) this.discard(entry); throw error; }
    let settle!: () => void; const settled = new Promise<void>(resolve => { settle = resolve; });
    let begin!: () => void; const launch = new Promise<void>(resolve => { begin = resolve; });
    const original = launch.then(() => this.execute(entry, budget)).catch(failure);
    const result = Promise.race([original, budget.expired]);
    const work = Object.freeze({ result, settled }); entry.cycle = { work, budget, settled: false }; entry.starting = false; begin();
    void original.finally(() => { budget.finish(); entry.cycle!.settled = true; settle(); });
    return work;
  }
  private discard(entry: Entry): void { entry.slot.release(); this.entries.delete(scopeId(entry.request)); }
  private async begin(entry: Entry, expected: RetirementIntent, budget: RetirementBudget): Promise<RetirementIntent> {
    const { journal } = this.options; entry.slot.fence(); entry.issued = true;
    try { return captureRetirementIntent(await journal.begin(entry.request), expected.request); }
    catch (original) {
      try { await journal.settleCarrier(); } catch { entry.sticky = true; throw new ProducerRetirementError('cleanup'); }
      this.check(budget);
      const observed = await journal.read(keyFor(entry.request));
      if (!observed) throw original; return captureRetirementIntent(observed, expected.request);
    }
  }
  private check(budget: RetirementBudget): void {
    budget.check(); if (this.closed) throw new ProducerRetirementError('closed');
  }
  private async execute(entry: Entry, budget: RetirementBudget): Promise<RetirementOutcome> {
    try {
      this.check(budget); const expected = captureRetirementIntent(await this.options.journal.preflight(entry.request), entry.request); this.check(budget);
      if (expected.namespaceIdentity !== this.options.gate.namespaceIdentity) throw new ProducerRetirementError('conflict');
      entry.intent = await this.begin(entry, expected, budget); this.check(budget);
      await entry.slot.confirm(entry.intent); this.check(budget);
      await this.drain(entry, budget); this.check(budget);
      if (this.closed) throw new ProducerRetirementError('closed');
      const token = mintBarrier(entry.intent, this.options.journal, () => !this.closed); this.discard(entry);
      return Object.freeze({ ok: true, value: token });
    } catch (error) { if (!entry.issued || (entry.drained && !entry.sticky)) this.discard(entry); throw error; }
  }
  private async drain(entry: Entry, budget: RetirementBudget): Promise<void> {
    const gate = entry.slot.drain();
    const native = Promise.resolve().then(() => { this.check(budget); return this.options.installation.retireOutput(entry.intent!, budget.operation); });
    const outcomes = await Promise.allSettled([gate, native]);
    if (outcomes[0].status === 'rejected') entry.sticky = true;
    if (outcomes[1].status === 'rejected') {
      const error: unknown = outcomes[1].reason;
      if (error && typeof error === 'object' && 'reason' in error && error.reason === 'cleanup') entry.sticky = true;
    }
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new ProducerRetirementError(entry.sticky ? 'cleanup' : 'unavailable');
    entry.drained = true;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    for (const entry of this.entries.values()) entry.cycle?.budget.stop('closed');
    this.closing = Promise.resolve().then(async () => {
      await Promise.all([...this.entries.values()].map(entry => entry.cycle?.work.settled));
      if (this.entries.size) throw new ProducerRetirementError('cleanup');
    });
    return this.closing;
  }
}
