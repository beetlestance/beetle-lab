import { Budget } from './budget.js';
import { parseSummary } from './json.js';
import { Reader } from './reader.js';
import { SummaryError } from './types.js';
import type { SummaryCollection, SummaryOptions, SummaryResult } from './types.js';
import { validateSummary } from './validation.js';
export type { SummaryCollection, SummaryOptions, SummaryResult, SummaryEvidence, MetricEvidence, SummaryCode } from './types.js';

/** Trusted private post-stop custody; no execution outcome or reservation release authority. */
export function readK6Summary(options: SummaryOptions): SummaryCollection {
  const budget = new Budget(options);
  const reader = new Reader(options, budget);
  let resolveQuiet!: () => void;
  let rejectQuiet!: (error: unknown) => void;
  const quiesced = new Promise<void>((resolve, reject) => { resolveQuiet = resolve; rejectQuiet = reject; });
  void quiesced.catch(() => undefined);
  let closeFailed = false;
  const task = Promise.resolve().then(async (): Promise<SummaryResult> => {
    let outcome: SummaryResult;
    try {
      budget.start(); requireStopped(options);
      const raw = await reader.read();
      const metrics = validateSummary(parseSummary(raw.bytes), options.compiledSuite);
      outcome = { ok: true, evidence: Object.freeze({ version: 1, metrics, rawBytes: raw.bytes.byteLength,
        sha256: raw.sha256, nativeCollection: options.process.collection }) };
    } catch (error) { outcome = failure(error, false); }
    try { await reader.close(); resolveQuiet(); }
    catch (error) { closeFailed = true; rejectQuiet(new SummaryError('filesystem')); outcome = failure(error, true); }
    // Both validation failures and successful evidence must survive the final clock fence.
    try { budget.check(); } catch (error) { outcome = failure(error, closeFailed); }
    budget.dispose(); return Object.freeze(outcome);
  });
  const result = budget.race(task).catch(error => {
    try { budget.check(); } catch (fence) { error = fence; }
    return Object.freeze(failure(error, closeFailed));
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({ result, quiesced, close: () => {
    // Publish ownership before any externally injected clock or IO completion.
    closing ??= Promise.resolve().then(() => quiesced);
    budget.stop('closed'); return closing;
  } });
}
function requireStopped(options: SummaryOptions): void {
  const observation = options.process;
  if (!observation.spawned || observation.state !== 'stopped' || !observation.groupAbsent
    || !observation.stdioClosed || !observation.quiescent) throw new SummaryError('process');
}
function failure(error: unknown, closeFailed: boolean): SummaryResult {
  return { ok: false, code: error instanceof SummaryError ? error.code : 'filesystem', closeFailed };
}
