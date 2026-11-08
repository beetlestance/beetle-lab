import type { Reservation } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { Entry } from './entry.js';
import type { InstallationOptions } from './types.js';

interface Context {
  readonly options: InstallationOptions;
  guard(entry: Entry, budget: Operation): void;
  stopGuard(entry: Entry): Promise<void>;
}
function fence(entry: Entry): void {
  if (!entry.watch) return;
  entry.watchClosing ??= entry.watch.close();
  void entry.watchClosing?.catch(() => { entry.cleanupFailed = true; });
}
function register(context: Context, entry: Entry, current: Reservation): void {
  if (entry.watch || !entry.plan) return;
  try { entry.watch = context.options.guard.watch(Object.freeze({ key: entry.key, plan: entry.plan, outputBytes: current.budget.outputBytes })); }
  catch { /* Failed registration cannot grant launch; claimed work is stopped below. */ }
}
function check(context: Context, entry: Entry, budget: Operation): void {
  try { context.guard(entry, budget); } catch (error) { fence(entry); throw error; }
}
function isReady(entry: Entry, initial: { ready: boolean }): boolean {
  return initial.ready && entry.watch?.status().ready === true && !entry.cancelled;
}
/** No readiness observation grants launch; the controller still checks durable intent. */
export async function ensureOutputWatch(context: Context, entry: Entry, current: Reservation, budget: Operation): Promise<boolean> {
  register(context, entry, current); check(context, entry, budget);
  const initial = entry.watch ? await entry.watch.initial : { ready: false };
  check(context, entry, budget);
  const ready = isReady(entry, initial);
  if (!ready && (current.createToken !== null || entry.controller)) await context.stopGuard(entry);
  return ready;
}
