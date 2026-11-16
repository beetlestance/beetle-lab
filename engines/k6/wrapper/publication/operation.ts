import type { EngineResult, ExecutionResult, StandaloneExportResult } from '@beetle/contracts';
import { Budget } from './budget.js';
import { Files } from './files.js';
import { snapshot } from './profile.js';
import type { PublicationIo } from './ports.js';
import { failure, PublicationError } from './types.js';
import type { PublicationOptions, ExportPublicationOptions, PublicationResult, ResultPublication } from './types.js';

/** Private composition seam for deterministic IO tests. */
export function createPublication(input: ExportPublicationOptions, io: PublicationIo): ResultPublication<StandaloneExportResult>;
export function createPublication(input: PublicationOptions, io: PublicationIo): ResultPublication<EngineResult>;
export function createPublication(input: PublicationOptions | ExportPublicationOptions, io: PublicationIo): ResultPublication<ExecutionResult> {
  let profile;
  try { profile = snapshot(input); }
  catch (error) { return denied(error); }
  const budget = new Budget(profile);
  const files = new Files(profile, budget, io);
  let resolveQuiet!: () => void;
  let rejectQuiet!: (error: unknown) => void;
  const quiesced = new Promise<void>((resolve, reject) => { resolveQuiet = resolve; rejectQuiet = reject; });
  void quiesced.catch(() => undefined);
  let closeFailed = false;
  const task = Promise.resolve().then(async (): Promise<PublicationResult<ExecutionResult>> => {
    let outcome: PublicationResult<ExecutionResult>;
    try {
      budget.start(); await files.open(); await files.write(); await files.publish();
      outcome = { ok: true, value: profile.value, relativePath: profile.relativePath,
        bytes: profile.bytes.byteLength, rawSha256: profile.rawSha256 };
    } catch (error) { outcome = failure(error); }
    try { await files.close(); resolveQuiet(); }
    catch { closeFailed = true; rejectQuiet(new PublicationError('filesystem')); outcome = failure(new PublicationError('filesystem')); }
    return outcome;
  });
  const publish = (outcome: PublicationResult<ExecutionResult>): PublicationResult<ExecutionResult> => {
    try { budget.check(); }
    catch (error) {
      if (!closeFailed || error instanceof PublicationError && error.code === 'cancelled') outcome = failure(error);
    }
    budget.dispose(); return Object.freeze(outcome);
  };
  const result = budget.race(task).then(publish, error => publish(failure(error)));
  let closing: Promise<void> | undefined;
  return Object.freeze({ result, quiesced, close: () => {
    closing ??= Promise.resolve().then(() => quiesced);
    budget.stop('closed'); return closing;
  } });
}
function denied(error: unknown): ResultPublication {
  const quiesced = Promise.resolve();
  return Object.freeze({ result: Promise.resolve(failure(error instanceof PublicationError ? error : new PublicationError('profile'))),
    quiesced, close: () => quiesced });
}
