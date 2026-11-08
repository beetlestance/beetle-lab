import { Budget } from './budget.js';
import { Files } from './files.js';
import { snapshot } from './profile.js';
import type { PublicationIo } from './ports.js';
import { failure, PublicationError } from './types.js';
import type { PublicationOptions, PublicationResult, ResultPublication } from './types.js';

/** Private composition seam for deterministic IO tests. */
export function createPublication(input: PublicationOptions, io: PublicationIo): ResultPublication {
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
  const task = Promise.resolve().then(async (): Promise<PublicationResult> => {
    let outcome: PublicationResult;
    try {
      budget.start(); await files.open(); await files.write(); await files.publish();
      outcome = { ok: true, value: profile.value, relativePath: 'engine-result.json',
        bytes: profile.bytes.byteLength, rawSha256: profile.rawSha256 };
    } catch (error) { outcome = failure(error); }
    try { await files.close(); resolveQuiet(); }
    catch { closeFailed = true; rejectQuiet(new PublicationError('filesystem')); outcome = failure(new PublicationError('filesystem')); }
    return outcome;
  });
  const publish = (outcome: PublicationResult): PublicationResult => {
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
