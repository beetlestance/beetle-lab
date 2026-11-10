import type { Entry } from './entry.js';
import type { EntryLease } from './leases.js';
import { drainLeases } from './leases.js';
import { InstallationError } from './types.js';

function original(issue: () => Promise<void>): Promise<void> {
  try { return issue(); } catch (error) { return Promise.reject(error); }
}
export function closeWatches(entry: Entry): void {
  if (entry.timeout) entry.timeoutClosing ??= original(() => entry.timeout!.close());
  if (entry.watch) entry.watchClosing ??= original(() => entry.watch!.close());
  for (const close of [entry.timeoutClosing, entry.watchClosing]) void close?.catch(() => { entry.cleanupFailed = true; });
}
async function settle(entry: Entry, originals: readonly (Promise<unknown> | undefined)[]): Promise<void> {
  const outcomes = await Promise.allSettled(originals);
  if (outcomes.some(value => value.status === 'rejected')) entry.cleanupFailed = true;
}
async function drainNative(entry: Entry, caller?: EntryLease): Promise<void> {
  await drainLeases(entry, caller);
  closeWatches(entry);
  await settle(entry, [entry.preparation?.result, entry.preparation?.quiesced, entry.watchClosing, entry.timeoutClosing]);
  // Public leases and watch closes include the callbacks which can assign this chain.
  const cancellation = entry.cancellation;
  await settle(entry, [cancellation]);
  if (entry.cancellation !== cancellation) entry.cleanupFailed = true;
  if (entry.controller) entry.closing ??= original(() => entry.controller!.close());
  await settle(entry, [entry.closing]);
  if (entry.cleanupFailed) throw new InstallationError('cleanup');
}
/** Sticky native completion is independent of retryable Journal metadata attempts. */
export function retireNative(entry: Entry, caller?: EntryLease): Promise<void> {
  entry.retiring = true;
  entry.nativeRetirement ??= drainNative(entry, caller);
  void entry.nativeRetirement.catch(() => { entry.cleanupFailed = true; });
  return entry.nativeRetirement;
}
